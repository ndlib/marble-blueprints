import codepipeline = require('@aws-cdk/aws-codepipeline')
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions')
import { ManualApprovalAction, GitHubTrigger } from '@aws-cdk/aws-codepipeline-actions'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Topic } from '@aws-cdk/aws-sns'
import cdk = require('@aws-cdk/core')
import { SlackApproval, PipelineNotifications } from '@ndlib/ndlib-cdk'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'
import { FoundationStack, PipelineFoundationStack } from '../foundation'


export interface IDeploymentPipelineStackProps extends cdk.StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly oauthTokenPath: string;
  readonly namespace: string;
  readonly contextEnvName: string;
  readonly owner: string;
  readonly contact: string;
  readonly rbscBucketName: string;
  readonly testFoundationStack: FoundationStack;
  readonly prodFoundationStack: FoundationStack;
  readonly lambdaCodePath: string;
  readonly dockerfilePath: string;
  readonly appRepoOwner: string;
  readonly appRepoName: string;
  readonly appSourceBranch: string;
  readonly infraRepoOwner: string;
  readonly infraRepoName: string;
  readonly infraSourceBranch: string;
  readonly createGithubWebhooks: boolean;
  readonly slackNotifyStackName?: string;
  readonly notificationReceivers?: string;
}

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-image-processing`
    const prodStackName = `${props.namespace}-prod-image-processing`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, foundationStack: FoundationStack) => {
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appSourceArtifact,
        appBuildCommands: [],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        contextEnvName: props.contextEnvName,
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
        oauthToken: cdk.SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
        output: appSourceArtifact,
        owner: props.appRepoOwner,
        repo: props.appRepoName,
        trigger: props.createGithubWebhooks ? GitHubTrigger.WEBHOOK : GitHubTrigger.POLL,
    })
    const infraSourceArtifact = new codepipeline.Artifact('InfraCode')
    const infraSourceAction = new codepipelineActions.GitHubSourceAction({
        actionName: 'InfraCode',
        branch: props.infraSourceBranch,
        oauthToken: cdk.SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
        output: infraSourceArtifact,
        owner: props.infraRepoOwner,
        repo: props.infraRepoName,
        trigger: props.createGithubWebhooks ? GitHubTrigger.WEBHOOK : GitHubTrigger.POLL,
    })

    // Deploy to Test
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, props.testFoundationStack)

    // Approval
    const appRepoUrl = `https://github.com/${props.appRepoOwner}/${props.appRepoName}`
    const approvalTopic = new Topic(this, 'ApprovalTopic')
    const approvalAction = new ManualApprovalAction({
      actionName: 'Approval',
      additionalInformation: `A new version of ${appRepoUrl} has been deployed to stack '${testStackName}' and is awaiting your approval. If you approve these changes, they will be deployed to stack '${prodStackName}'.`,
      notificationTopic: approvalTopic,
      runOrder: 99, // This should always be the last action in the stage
    })
    if(props.slackNotifyStackName !== undefined){
      const slackApproval = new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    // Deploy to Production
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, props.prodFoundationStack)

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
      const notifications = new PipelineNotifications(this, 'PipelineNotifications', {
        pipeline,
        receivers: props.notificationReceivers,
      })
    }
  }
}