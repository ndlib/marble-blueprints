import codepipeline = require('aws-cdk-lib/aws-codepipeline')
import codepipelineActions = require('aws-cdk-lib/aws-codepipeline-actions')
import { GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Fn, SecretValue, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from "constructs"
import { PipelineNotifications, SlackIntegratedManualApproval, SlackSubscription } from '@ndlib/ndlib-cdk2'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'
import { FoundationStack, PipelineFoundationStack } from '../foundation'


export interface IDeploymentPipelineStackProps extends StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly oauthTokenPath: string
  readonly namespace: string
  readonly contextEnvName: string
  readonly owner: string
  readonly contact: string
  readonly rbscBucketName: string
  readonly testFoundationStack: FoundationStack
  readonly prodFoundationStack: FoundationStack
  readonly lambdaCodePath: string
  readonly dockerfilePath: string
  readonly appRepoOwner: string
  readonly appRepoName: string
  readonly appSourceBranch: string
  readonly infraRepoOwner: string
  readonly infraRepoName: string
  readonly infraSourceBranch: string
  readonly createGithubWebhooks: boolean
  readonly slackChannelId: string
  readonly slackChannelName: string
  readonly slackNotifyTopicOutput: string
  readonly notificationReceivers?: string
  readonly dockerhubCredentialsPath: string
}

export class DeploymentPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-image-processing`
    const prodStackName = `${props.namespace}-prod-image-processing`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, foundationStack: FoundationStack, stage: string) => {
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appSourceArtifact,
        appBuildCommands: [],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        contextEnvName: props.contextEnvName,
        dockerhubCredentialsPath: props.dockerhubCredentialsPath,
        stage,
        additionalContext: {
          description: "Image processing",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
          "imageProcessing:imageBucketName": foundationStack.publicBucket.bucketName,
          "imageProcessing:lambdaCodePath": "$CODEBUILD_SRC_DIR_AppCode/s3_event",
          "imageProcessing:dockerfilePath": "$CODEBUILD_SRC_DIR_AppCode/",
        },
      })
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['ssm:Get*'],
        resources:['*'],
      }))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.globals(
        [
          GlobalActions.ECR, GlobalActions.EC2, GlobalActions.ECS,
          GlobalActions.Autoscaling, GlobalActions.Cloudwatch,
        ],
      ))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamInstanceProfile(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ecr())
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.autoscale(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.events(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.sns(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.logstream(targetStack))

      return cdkDeploy
    }

    // Source Actions
    const appSourceArtifact = new codepipeline.Artifact('AppCode')
    const appSourceAction = new codepipelineActions.GitHubSourceAction({
        actionName: 'AppCode',
        branch: props.appSourceBranch,
        oauthToken: SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
        output: appSourceArtifact,
        owner: props.appRepoOwner,
        repo: props.appRepoName,
        trigger: props.createGithubWebhooks ? GitHubTrigger.WEBHOOK : GitHubTrigger.POLL,
    })
    const infraSourceArtifact = new codepipeline.Artifact('InfraCode')
    const infraSourceAction = new codepipelineActions.GitHubSourceAction({
        actionName: 'InfraCode',
        branch: props.infraSourceBranch,
        oauthToken: SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
        output: infraSourceArtifact,
        owner: props.infraRepoOwner,
        repo: props.infraRepoName,
        trigger: props.createGithubWebhooks ? GitHubTrigger.WEBHOOK : GitHubTrigger.POLL,
    })

    // Deploy to Test
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, props.testFoundationStack, 'test')

    // Approval
    const importedSlackNotifyTopicArn = Fn.importValue(props.slackNotifyTopicOutput)
    const approvalTopic = Topic.fromTopicArn(this, 'SlackTopicFromArn', importedSlackNotifyTopicArn)
    const approvalAction = new SlackIntegratedManualApproval({
      actionName: 'ApproveTestStack',
      notificationTopic: approvalTopic,
      customData: {
        successfulTarget: `stack ${testStackName}`,
        attemptTarget: `stack ${prodStackName}`,
        slackChannelId: props.slackChannelId,
        slackChannelName: props.slackChannelName,
        githubSources: [
          { owner: props.appRepoOwner, sourceAction: appSourceAction },
          { owner: props.infraRepoOwner, sourceAction: infraSourceAction },
        ],
      },
    })

    // Deploy to Production
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, props.prodFoundationStack, 'prod')

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket: props.pipelineFoundationStack.artifactBucket,
      stages: [
        {
          actions: [appSourceAction, infraSourceAction],
          stageName: 'Source',
        },
        {
          actions: [deployTest.action, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action],
          stageName: 'Production',
        },
      ],
    })
    if(props.notificationReceivers){
      new PipelineNotifications(this, 'PipelineNotifications', {
        pipeline,
        receivers: props.notificationReceivers,
      })
    }
  }
}