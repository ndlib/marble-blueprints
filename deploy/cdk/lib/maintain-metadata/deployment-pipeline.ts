import codepipeline = require('@aws-cdk/aws-codepipeline')
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions')
import { ManualApprovalAction, GitHubTrigger } from '@aws-cdk/aws-codepipeline-actions'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Topic } from '@aws-cdk/aws-sns'
import cdk = require('@aws-cdk/core')
import { SlackApproval, PipelineNotifications } from '@ndlib/ndlib-cdk'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy } from '../namespaced-policy'
import { PipelineFoundationStack } from '../foundation'
import { GithubApproval } from '../github-approval'

export interface IDeploymentPipelineStackProps extends cdk.StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack;
  readonly oauthTokenPath: string; // Note:  This is a secretstore value, not an ssm value /esu/github/ndlib-git
  readonly infraRepoOwner: string;
  readonly infraRepoName: string;
  readonly infraSourceBranch: string;
  readonly namespace: string;
  readonly contextEnvName: string;
  readonly owner: string;
  readonly contact: string;
  readonly sentryDsn: string;
  readonly slackNotifyStackName?: string;
  readonly notificationReceivers?: string;
  readonly createGithubWebhooks: boolean;
 }


export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-maintain-metadata`
    const prodStackName = `${props.namespace}-prod-maintain-metadata`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, deployConstructName: string) => {
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
        ],
        resources: [
          cdk.Fn.sub('arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:*'),
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
          cdk.Fn.sub('arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:apis/*'),
        ],
      }))
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          'appsync:CreateDataSource',
          'appsync:DeleteDataSource',
        ],
        resources: [
          cdk.Fn.sub('arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:/createdatasource'),
        ],
      }))
      return cdkDeploy
    }

    // Source Actions
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
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, `${props.namespace}-maintain-metadata-deploy-test`)

    // Approval
    const approvalTopic = new Topic(this, 'ApprovalTopic')
    const approvalAction = new GithubApproval({
      notificationTopic: approvalTopic,
      testTarget: `stack ${testStackName}`,
      prodTarget: `stack ${prodStackName}`,
      githubSources: [
        { owner: props.infraRepoOwner, sourceAction: infraSourceAction },
      ],
    })
    if(props.slackNotifyStackName !== undefined){
      new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    // Deploy to Production
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, `${props.namespace}-maintain-metadata-deploy-prod`)

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