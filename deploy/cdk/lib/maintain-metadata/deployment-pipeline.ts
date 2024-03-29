import codepipeline = require('aws-cdk-lib/aws-codepipeline')
import codepipelineActions = require('aws-cdk-lib/aws-codepipeline-actions')
import { GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Fn, SecretValue, Stack, StackProps } from  'aws-cdk-lib'
import { Construct } from "constructs"
import { PipelineNotifications, SlackIntegratedManualApproval } from '@ndlib/ndlib-cdk2'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy } from '../namespaced-policy'
import { PipelineFoundationStack } from '../foundation'

export interface IDeploymentPipelineStackProps extends StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly oauthTokenPath: string // Note:  This is a secretstore value, not an ssm value /esu/github/ndlib-git
  readonly infraRepoOwner: string
  readonly infraRepoName: string
  readonly infraSourceBranch: string
  readonly namespace: string
  readonly contextEnvName: string
  readonly owner: string
  readonly contact: string
  readonly sentryDsn: string
  readonly slackChannelId: string
  readonly slackChannelName: string
  readonly slackNotifyTopicOutput: string
  readonly notificationReceivers?: string
  readonly createGithubWebhooks: boolean
  readonly dockerhubCredentialsPath: string
 }


export class DeploymentPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-maintain-metadata`
    const prodStackName = `${props.namespace}-prod-maintain-metadata`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, deployConstructName: string, stage: string) => {
      const cdkDeploy = new CDKPipelineDeploy(this, deployConstructName, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appBuildCommands: [
          'echo "Ready to try to deploy stack"',
          'yarn',
        ],
        outputFiles: [
          `**/*`,
        ],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        contextEnvName: props.contextEnvName,
        dockerhubCredentialsPath: props.dockerhubCredentialsPath,
        stage,
        additionalContext: {
          description: "data pipeline for maintaining metadata",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
        },
      })
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.api())
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.events(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.logstream(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.dynamodb(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
      // Allow target stack to create AppSync resources
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          'appsync:TagResource',
          'appsync:CreateGraphqlApi',
          'appsync:StartSchemaCreation',
          'appsync:GetSchemaCreationStatus',
          'appsync:CreateResolver',
          'appsync:CreateApiKey',
          'appsync:UpdateApiKey',
          'appsync:CreateFunction',
          'appsync:DeleteResolver',
          'appsync:DeleteApiKey',
          'appsync:DeleteFunction',
          'appsync:GetFunction',
          'appsync:GetResolver',
          'appsync:UpdateResolver',
          'appsync:UpdateFunction',
          'appsync:DeleteDataSource',
        ],
        resources: [
          Fn.sub('arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:*'),
        ],
      }))
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          'appsync:GetGraphqlApi',
          'appsync:StartSchemaCreation',
          'appsync:ListTagsForResource',
          'appsync:UntagResource',
          'appsync:UpdateGraphqlApi',
          'appsync:DeleteGraphqlApi',
        ],
        resources: [
          Fn.sub('arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:apis/*'),
        ],
      }))
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          'appsync:CreateDataSource',
          'appsync:DeleteDataSource',
        ],
        resources: [
          Fn.sub('arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:/createdatasource'),
        ],
      }))
      return cdkDeploy
    }

    // Source Actions
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
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, `${props.namespace}-maintain-metadata-deploy-test`, 'test')

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
          { owner: props.infraRepoOwner, sourceAction: infraSourceAction },
        ],
      },
    })

    // Deploy to Production
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, `${props.namespace}-maintain-metadata-deploy-prod`, 'prod')

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket: props.pipelineFoundationStack.artifactBucket,
      stages: [
        {
          actions: [infraSourceAction],
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