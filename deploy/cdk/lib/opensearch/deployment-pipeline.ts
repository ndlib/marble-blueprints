import codepipeline = require('@aws-cdk/aws-codepipeline')
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions')
import { GitHubTrigger } from '@aws-cdk/aws-codepipeline-actions'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Topic } from '@aws-cdk/aws-sns'
import cdk = require('@aws-cdk/core')
import { SlackApproval, PipelineNotifications } from '@ndlib/ndlib-cdk'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'
import { PipelineFoundationStack } from '../foundation/pipeline-foundation-stack'
import { GithubApproval } from '../github-approval'

export interface IDeploymentPipelineStackProps extends cdk.StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly oauthTokenPath: string;
  readonly namespace: string;
  readonly contextEnvName: string;
  readonly owner: string;
  readonly contact: string;
  readonly esDomainName: string;
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

    const testStackName = `${props.namespace}-test-opensearch`
    const prodStackName = `${props.namespace}-prod-opensearch`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string) => {
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appBuildCommands: [],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        contextEnvName: props.contextEnvName,
        additionalContext: {
          description: "Opensearch cluster",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
        },
      })
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.opensearch(namespace))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.opensearchInvoke(namespace))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))
      cdkDeploy.project.addToRolePolicy(
        NamespacedPolicy.globals([GlobalActions.Cloudwatch, GlobalActions.ES, GlobalActions.EC2]))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.sns(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))

      // Allow ability to create a Service Linked Role
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['iam:CreateServiceLinkedRole',
          'iam:GetRole',
          'iam:DeleteServiceLinkedRole',
          'iam:GetServiceLinkedRoleDeletionStatus',
        ],
        resources: [
          cdk.Fn.sub('arn:aws:iam::${AWS::AccountId}:role/aws-service-role/es.amazonaws.com/*'),
        ],
      }))
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['iam:ListRoles'],
        resources: [
          cdk.Fn.sub('arn:aws:sts::${AWS::AccountId}:role/aws-service-role/es.amazonaws.com/'),  // sts
          cdk.Fn.sub('arn:aws:iam::${AWS::AccountId}:role/aws-service-role/es.amazonaws.com/'),  // iam
        ],
      }))
      
      // Allow SecretsManager access
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          'secretsmanager:GetRandomPassword',
          'secretsmanager:CreateSecret',
          'secretsmanager:DeleteSecret',
          'secretsmanager:TagResource',
          'secretsmanager:GetSecretValue',
        ],
        resources: ['*'],  // may need to add to stack, and grant resource of opensearch domain
      }))
      // log access
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          'logs:PutRetentionPolicy',
          'logs:ListTagsLogGroup',
        ],
        resources: [
          cdk.Fn.sub('arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:') + testStackName + '*',
          cdk.Fn.sub('arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:') + prodStackName + '*',
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
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`)

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
      const slackApproval = new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    // Deploy to Production
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`)

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
      const notifications = new PipelineNotifications(this, 'PipelineNotifications', {
        pipeline,
        receivers: props.notificationReceivers,
      })
    }
  }
}
