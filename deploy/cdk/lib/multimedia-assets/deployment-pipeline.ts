import codepipeline = require('aws-cdk-lib/aws-codepipeline')
import codepipelineActions = require('aws-cdk-lib/aws-codepipeline-actions')
import { GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { SecretValue, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NewmanRunner, PipelineNotifications, SlackIntegratedManualApproval, SlackSubscription } from '@ndlib/ndlib-cdk2'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { FoundationStack, PipelineFoundationStack } from '../foundation'
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'

export interface IDeploymentPipelineStackProps extends StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly contextEnvName: string
  readonly oauthTokenPath: string
  readonly infraRepoOwner: string
  readonly infraRepoName: string
  readonly infraSourceBranch: string
  readonly createGithubWebhooks: boolean
  readonly namespace: string
  readonly owner: string
  readonly contact: string
  readonly projectName: string
  readonly description: string
  readonly slackChannelId: string
  readonly slackChannelName: string
  readonly slackNotifyStackName?: string
  readonly notificationReceivers?: string
  readonly testFoundationStack: FoundationStack
  readonly prodFoundationStack: FoundationStack
  readonly hostnamePrefix: string
  readonly dockerhubCredentialsPath: string
  readonly domainName: string
  readonly hostedZoneTypes: string[]
}

export class DeploymentPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-multimedia-assets`
    const prodStackName = `${props.namespace}-prod-multimedia-assets`
    const testHostnamePrefix = props.hostnamePrefix ? `${props.hostnamePrefix}-test` : `${props.namespace}-multimedia-test`
    const prodHostnamePrefix = props.hostnamePrefix || `${props.namespace}-multimedia`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, hostnamePrefix: string, stage: string) => {
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appBuildCommands: [],
        cdkDirectory: 'deploy/cdk',
        namespace,
        contextEnvName: props.contextEnvName,
        dockerhubCredentialsPath: props.dockerhubCredentialsPath,
        stage,
        additionalContext: {
          description: props.description,
          projectName: props.projectName,
          owner: props.owner,
          contact: props.contact,
          "multimediaAssets:hostnamePrefix": hostnamePrefix,
        },
      })
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          's3:GetBucketAcl',
          's3:PutBucketAcl',
        ],
        resources: [
          props.testFoundationStack.logBucket.bucketArn,
          props.prodFoundationStack.logBucket.bucketArn,
        ],
      }))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.globals([
        GlobalActions.Cloudfront,
        GlobalActions.Route53,
        GlobalActions.S3,
      ]))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.s3(testHostnamePrefix))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.s3(prodHostnamePrefix))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))

      // Grant permission for creating DNS
      for (const hostedZoneType of props.hostedZoneTypes) {
        const hostedZoneIdPath = `/all/dns/${props.domainName}/${hostedZoneType}/zoneId`
        const hostedZoneId = StringParameter.valueForStringParameter(this, hostedZoneIdPath)
        cdkDeploy.project.addToRolePolicy(NamespacedPolicy.route53RecordSet(hostedZoneId))
      }

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
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, testHostnamePrefix, 'test')

    const testHostname = `${testHostnamePrefix}.${props.domainName}`
    const testHost = StringParameter.valueForStringParameter(this, `/all/stacks/${testStackName}/api-url`)
    const newmanRunnerTest = new NewmanRunner(this, 'NewmanRunnerTest', {
      sourceArtifact: infraSourceArtifact,
      collectionPath: 'deploy/cdk/test/multimedia-assets/smokeTests.json',
      collectionVariables: {
        hostname: testHost,
      },
      actionName: 'SmokeTests',
    })

    // Deploy to Production
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, prodHostnamePrefix, 'prod')

    const prodHostname = `${prodHostnamePrefix}.${props.domainName}`
    const prodHost = StringParameter.valueForStringParameter(this, `/all/stacks/${prodStackName}/api-url`)
    const newmanRunnerProd = new NewmanRunner(this, 'NewmanRunnerProd', {
      sourceArtifact: infraSourceArtifact,
      collectionPath: 'deploy/cdk/test/multimedia-assets/smokeTests.json',
      collectionVariables: {
        hostname: prodHost,
      },
      actionName: 'SmokeTests',
    })

    // Approval
    const approvalTopic = new Topic(this, 'ApprovalTopic')
    const approvalAction = new SlackIntegratedManualApproval({
      actionName: 'ApproveTestStack',
      notificationTopic: approvalTopic,
      customData: {
        successfulTarget: `https://${testHostname}`,
        attemptTarget: `https://${prodHostname}`,
        slackChannelId: props.slackChannelId,
        slackChannelName: props.slackChannelName,
        githubSources: [
          { owner: props.infraRepoOwner, sourceAction: infraSourceAction },
        ],
      },
    })
    if (props.slackNotifyStackName !== undefined) {
      new SlackSubscription(this, 'SlackSubscription', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket: props.pipelineFoundationStack.artifactBucket,
      stages: [
        {
          actions: [infraSourceAction],
          stageName: 'Source',
        },
        {
          actions: [deployTest.action, newmanRunnerTest.action, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action, newmanRunnerProd.action],
          stageName: 'Production',
        },
      ],
    })
    if (props.notificationReceivers) {
      new PipelineNotifications(this, 'PipelineNotifications', {
        pipeline,
        receivers: props.notificationReceivers,
      })
    }
  }
}
