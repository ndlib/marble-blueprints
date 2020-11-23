import { BuildEnvironmentVariableType, BuildSpec, LinuxBuildImage, PipelineProject } from '@aws-cdk/aws-codebuild'
import codepipeline = require('@aws-cdk/aws-codepipeline')
import { Artifact } from '@aws-cdk/aws-codepipeline'
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions')
import { ManualApprovalAction, GitHubTrigger } from '@aws-cdk/aws-codepipeline-actions'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Topic } from '@aws-cdk/aws-sns'
import cdk = require('@aws-cdk/core')
import { PipelineNotifications, SlackApproval } from '@ndlib/ndlib-cdk'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { FoundationStack, PipelineFoundationStack } from '../foundation'
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'
import { PipelineS3Sync } from './pipeline-s3-sync'
import { ElasticStack } from '../elasticsearch'

export interface IDeploymentPipelineStackProps extends cdk.StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly contextEnvName: string
  readonly oauthTokenPath: string
  readonly appRepoOwner: string
  readonly appRepoName: string
  readonly appSourceBranch: string
  readonly infraRepoOwner: string
  readonly infraRepoName: string
  readonly infraSourceBranch: string
  readonly createGithubWebhooks: boolean
  readonly qaSpecPath: string
  readonly namespace: string
  readonly instanceName: string
  readonly owner: string
  readonly contact: string
  readonly projectName: string
  readonly description: string
  readonly slackNotifyStackName?: string
  readonly notificationReceivers?: string
  readonly testFoundationStack: FoundationStack
  readonly prodFoundationStack: FoundationStack
  readonly hostnamePrefix: string
  readonly buildScriptsDir: string
  readonly buildOutputDir: string
  readonly createDns: boolean
  readonly testElasticStack: ElasticStack
  readonly prodElasticStack: ElasticStack
  readonly searchIndex?: string
}

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-${props.instanceName}`
    const prodStackName = `${props.namespace}-prod-${props.instanceName}`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, hostnamePrefix: string, buildPath: string, outputArtifact: Artifact, foundationStack: FoundationStack, elasticStack: ElasticStack) => {
      const paramsPath = `/all/static-host/${targetStack}/`
      const esEndpointParamPath = `/all/stacks/${elasticStack.stackName}/domain-endpoint`
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appSourceArtifact,
        appBuildCommands: [
        ],
        outputDirectory: buildPath,
        outputFiles: [
          `**/*`,
        ],
        outputArtifact: outputArtifact,
        cdkDirectory: 'deploy/cdk',
        namespace,
        contextEnvName: props.contextEnvName,
        additionalContext: {
          description: props.description,
          projectName: props.projectName,
          owner: props.owner,
          contact: props.contact,
          [`${props.instanceName}:hostnamePrefix`]: hostnamePrefix,
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
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.s3(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.elasticsearchInvoke(elasticStack.domainName))

      if (props.createDns) {
        cdkDeploy.project.addToRolePolicy(NamespacedPolicy.route53RecordSet(foundationStack.hostedZone.hostedZoneId))
      }

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
    const testHostnamePrefix = props.hostnamePrefix ? `${props.hostnamePrefix}-test` : testStackName
    const testBuildPath = `$CODEBUILD_SRC_DIR_${appSourceArtifact.artifactName}`
    const testBuildOutput = new Artifact('TestBuild')
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, testHostnamePrefix, testBuildPath, testBuildOutput, props.testFoundationStack, props.testElasticStack)
    const s3syncTest = new PipelineS3Sync(this, 'S3SyncTest', {
      targetStack: testStackName,
      inputBuildArtifact: testBuildOutput,
      artifactPath: testBuildPath,
      searchIndex: props.searchIndex,
      esEndpointParamPath: `/all/stacks/${props.testElasticStack.stackName}/domain-endpoint`,
      elasticSearchDomainName: props.testElasticStack.domainName,
    })

    const testHostname = `${testHostnamePrefix}.${props.testFoundationStack.hostedZone.zoneName}`
    const smokeTestsProject = new PipelineProject(this, 'StaticHostSmokeTests', {
      buildSpec: BuildSpec.fromObject({
        phases: {
          build: {
            commands: [
              `chmod -R 755 ${props.qaSpecPath}`,
              `newman run ${props.qaSpecPath} --env-var hostname=${testHostname}`,
            ],
          },
        },
        version: '0.2',
      }),
      environment: {
        buildImage: LinuxBuildImage.fromDockerRegistry('postman/newman'),
      },
    })
    const smokeTestsAction = new codepipelineActions.CodeBuildAction({
      input: appSourceArtifact,
      project: smokeTestsProject,
      actionName: 'SmokeTests',
      runOrder: 98,
    })

    // Approval
    const appRepoUrl = `https://github.com/${props.appRepoOwner}/${props.appRepoName}`
    const approvalTopic = new Topic(this, 'ApprovalTopic')
    const approvalAction = new ManualApprovalAction({
      actionName: 'Approval',
      additionalInformation: `A new version of ${appRepoUrl} has been deployed to stack '${testStackName}' and is awaiting your approval. If you approve these changes, they will be deployed to stack '${prodStackName}'.`,
      notificationTopic: approvalTopic,
      runOrder: 99, // This should always be the last action in the stage
    })
    if (props.slackNotifyStackName !== undefined) {
      new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    // Deploy to Production
    const prodHostnamePrefix = props.hostnamePrefix ? props.hostnamePrefix : `${props.namespace}-${props.instanceName}`
    const prodBuildPath = `$CODEBUILD_SRC_DIR_${appSourceArtifact.artifactName}`
    const prodBuildOutput = new Artifact('ProdBuild')
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, prodHostnamePrefix, prodBuildPath, prodBuildOutput, props.prodFoundationStack, props.prodElasticStack)

    const s3syncProd = new PipelineS3Sync(this, 'S3SyncProd', {
      targetStack: prodStackName,
      inputBuildArtifact: prodBuildOutput,
      artifactPath: prodBuildPath,
      searchIndex: props.searchIndex,
      esEndpointParamPath: `/all/stacks/${props.prodElasticStack.stackName}/domain-endpoint`,
      elasticSearchDomainName: props.prodElasticStack.domainName,
    })

    const prodHostname = `${prodHostnamePrefix}.${props.prodFoundationStack.hostedZone.zoneName}`
    const smokeTestsProdProject = new PipelineProject(this, 'StaticHostProdSmokeTests', {
      buildSpec: BuildSpec.fromObject({
        phases: {
          build: {
            commands: [
              `chmod -R 755 ${props.qaSpecPath}`,
              `newman run ${props.qaSpecPath} --env-var hostname=${prodHostname}`,
            ],
          },
        },
        version: '0.2',
      }),
      environment: {
        buildImage: LinuxBuildImage.fromDockerRegistry('postman/newman'),
      },
    })
    const smokeTestsProdAction = new codepipelineActions.CodeBuildAction({
      input: appSourceArtifact,
      project: smokeTestsProdProject,
      actionName: 'SmokeTests',
      runOrder: 98,
    })

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket: props.pipelineFoundationStack.artifactBucket,
      stages: [
        {
          actions: [appSourceAction, infraSourceAction],
          stageName: 'Source',
        },
        {
          actions: [deployTest.action, s3syncTest.action, smokeTestsAction, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action, s3syncProd.action, smokeTestsProdAction],
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
