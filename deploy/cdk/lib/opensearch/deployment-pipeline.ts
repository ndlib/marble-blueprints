import codepipeline = require('aws-cdk-lib/aws-codepipeline')
import codepipelineActions = require('aws-cdk-lib/aws-codepipeline-actions')
import { GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Fn, SecretValue, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { PipelineNotifications } from '@ndlib/ndlib-cdk2'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'
import { PipelineFoundationStack } from '../foundation/pipeline-foundation-stack'

export interface IDeploymentPipelineStackProps extends StackProps {
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

export class DeploymentPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-opensearch`
    const prodStackName = `${props.namespace}-prod-opensearch`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, contextEnvName: string) => {
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appBuildCommands: [],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        contextEnvName: contextEnvName,
        additionalContext: {
          description: "Opensearch cluster",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
        },
      })
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.opensearch(props.namespace)) // Because domains are named like marblebproddoma-0ioig7rg3ag6, passing "marbleb-prod" failed.  Passing simply "marbleb" works, since NamespacedPolicy appends "*"
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
          Fn.sub('arn:aws:iam::${AWS::AccountId}:role/aws-service-role/es.amazonaws.com/*'),
        ],
      }))
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['iam:ListRoles'],
        resources: [
          Fn.sub('arn:aws:sts::${AWS::AccountId}:role/aws-service-role/es.amazonaws.com/'),  // sts
          Fn.sub('arn:aws:iam::${AWS::AccountId}:role/aws-service-role/es.amazonaws.com/'),  // iam
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
          Fn.sub('arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:') + testStackName + '*',
          Fn.sub('arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:') + prodStackName + '*',
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

    // Because of cost issues, we are removing the OpenSearch test stack
    // Deploy to Production
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, props.contextEnvName)

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket: props.pipelineFoundationStack.artifactBucket,
      stages: [
        {
          actions: [infraSourceAction],
          stageName: 'Source',
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
