import codepipeline = require('aws-cdk-lib/aws-codepipeline')
import { Artifact } from 'aws-cdk-lib/aws-codepipeline'
import codepipelineActions = require('aws-cdk-lib/aws-codepipeline-actions')
import { GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions'
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { Fn, SecretValue, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NewmanRunner, PipelineNotifications, SlackIntegratedManualApproval } from '@ndlib/ndlib-cdk2'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { FoundationStack, PipelineFoundationStack } from '../foundation'
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'
import { IPipelineS3SyncProps, PipelineS3Sync } from './pipeline-s3-sync'
import { MaintainMetadataStack } from '../maintain-metadata'
import { ManifestLambdaStack } from '../manifest-lambda'

export interface IDeploymentPipelineStackProps extends StackProps {
  readonly appRepoName: string
  readonly appRepoOwner: string
  readonly appSourceBranch: string
  readonly buildScriptsDir: string
  readonly contact: string
  readonly contextEnvName: string
  readonly createGithubWebhooks: boolean
  readonly description: string
  readonly dockerhubCredentialsPath: string
  readonly domainName: string
  readonly hostedZoneTypes: string[]
  readonly hostedZoneTypesTest: string[]
  readonly hostnamePrefix: string
  readonly infraRepoName: string
  readonly infraRepoOwner: string
  readonly infraSourceBranch: string
  readonly instanceName: string
  readonly namespace: string
  readonly notificationReceivers?: string
  readonly oauthTokenPath: string
  readonly oktaClientIdField: string
  readonly oktaIssuerField: string,
  readonly oktaSecret: string,
  readonly oktaUrl: string
  readonly opensearchSecretsKeyPath: string
  readonly owner: string
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly prodAdditionalAliases?: string
  readonly prodCertificateArnPath?: string
  readonly prodDomainNameOverride?: string
  readonly prodFoundationStack: FoundationStack
  readonly prodMaintainMetadataStack: MaintainMetadataStack
  readonly prodManifestLambdaStack: ManifestLambdaStack
  readonly projectName: string
  readonly qaSpecPath: string
  readonly searchIndex: string
  readonly siteDirectory: string
  readonly slackChannelId: string
  readonly slackChannelName: string
  readonly slackNotifyTopicOutput: string
  readonly submoduleRepoName?: string
  readonly submoduleSourceBranch?: string
  readonly testFoundationStack: FoundationStack
  readonly testMaintainMetadataStack: MaintainMetadataStack
  readonly testManifestLambdaStack: ManifestLambdaStack
  readonly workspaceName: string

}

export class DeploymentPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-${props.instanceName}`
    const prodStackName = `${props.namespace}-prod-${props.instanceName}`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, hostnamePrefix: string, buildPath: string, outputArtifact: Artifact, stage: string,
                          certificateArnPath?: string, domainNameOverride?:string, additionalAliases?: string) => {

      const additionalContext = {
        description: props.description,
        projectName: props.projectName,
        owner: props.owner,
        contact: props.contact,
        [`${props.instanceName}:hostnamePrefix`]: hostnamePrefix,
      }
      if (certificateArnPath) {
        additionalContext[`${props.instanceName}:certificateArnPath`] = certificateArnPath
      }
      if (domainNameOverride) {
        additionalContext[`${props.instanceName}:domainNameOverride`] = domainNameOverride
      }
      if (additionalAliases) {
        additionalContext[`${props.instanceName}:additionalAliases`] = additionalAliases
      }
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
        dockerhubCredentialsPath: props.dockerhubCredentialsPath,
        stage,
        additionalContext: additionalContext,
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
        GlobalActions.Secrets,
      ]))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.s3(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.opensearchInvoke(props.namespace))  // Because the domainName isn't available at synth time, and because the domain names start with the namespace name, I'll use the namespace name here to grant access to all domains starting with this namespace name
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [
          Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.testMaintainMetadataStack.maintainMetadataKeyBase + '*'),
          Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodMaintainMetadataStack.maintainMetadataKeyBase + '*'),
          Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.testManifestLambdaStack.publicGraphqlApiKeyPath + '*'),
          Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodManifestLambdaStack.publicGraphqlApiKeyPath + '*'),
        ],
        actions: ["ssm:Get*"],
      }))

      // Grant permission for creating DNS
      for (const hostedZoneType of props.hostedZoneTypes) {
        const hostedZoneIdPath = `/all/dns/${props.domainName}/${hostedZoneType}/zoneId`
        const hostedZoneId = StringParameter.valueForStringParameter(this, hostedZoneIdPath)
        cdkDeploy.project.addToRolePolicy(NamespacedPolicy.route53RecordSet(hostedZoneId))
      }

      if (certificateArnPath) {
        cdkDeploy.project.addToRolePolicy(new PolicyStatement({
          actions: [
            'ssm:GetParameters',
          ],
          resources: [
            Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + certificateArnPath),
          ],
        }))
      }
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
    // Submodule App Source
    let subAppSourceAction
    let subAppSourceArtifact
    if (props.submoduleRepoName !== undefined) {
      subAppSourceArtifact = new codepipeline.Artifact('SubAppCode')
      subAppSourceAction = new codepipelineActions.GitHubSourceAction({
          actionName: 'SubAppCode',
          branch: props.submoduleSourceBranch,
          oauthToken: SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
          output: subAppSourceArtifact,
          owner: props.appRepoOwner,
          repo: props.submoduleRepoName,
          trigger: props.createGithubWebhooks ? GitHubTrigger.WEBHOOK : GitHubTrigger.POLL,
      })
    }
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
    const testHostnamePrefix = props.hostnamePrefix ? `${props.hostnamePrefix}-test` : testStackName
    const testBuildPath = `$CODEBUILD_SRC_DIR_${appSourceArtifact.artifactName}`
    const testBuildOutput = new Artifact('TestBuild')
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, testHostnamePrefix, testBuildPath, testBuildOutput, 'test')
    const s3syncTestProps: IPipelineS3SyncProps = {
      targetStack: testStackName,
      inputBuildArtifact: appSourceArtifact,
      searchIndex: `${props.searchIndex}-test`,
      siteDirectory: props.siteDirectory,
      workspaceName: props.workspaceName,
      graphqlApiUrlKeyPath: props.testMaintainMetadataStack.graphqlApiUrlKeyPath,
      graphqlApiKeyKeyPath: props.testMaintainMetadataStack.graphqlApiKeyKeyPath,
      publicGraphqlApiKeyPath: props.testManifestLambdaStack.publicGraphqlApiKeyPath,
      buildEnvironment: 'test',
      maintainMetadataKeyBase: props.testMaintainMetadataStack.maintainMetadataKeyBase,
      oktaClientIdField: props.oktaClientIdField,
      oktaIssuerField: props.oktaIssuerField,
      oktaSecret: props.oktaSecret,
      oktaUrl: props.oktaUrl,
      opensearchSecretsKeyPath: props.opensearchSecretsKeyPath,
    }
    if (subAppSourceArtifact !== undefined) {
      s3syncTestProps.extraBuildArtifacts = [subAppSourceArtifact]
    }
    const s3syncTest = new PipelineS3Sync(this, 'S3SyncTest', s3syncTestProps)

    const testHostname = `${testHostnamePrefix}.${props.domainName}`
    let smokeTestsProject
    const testActions: codepipeline.IAction[] = [deployTest.action, s3syncTest.action]
    if (props.hostedZoneTypesTest.includes('public')){
      // const testHost = StringParameter.valueForStringParameter(this, `/all/stacks/${testStackName}/website-url`)
      smokeTestsProject = new NewmanRunner(this, 'StaticHostSmokeTests', {
        sourceArtifact: appSourceArtifact,
        collectionPath: props.qaSpecPath,
        collectionVariables: {
          'hostname': testHostname,
        },
        actionName: 'SmokeTests',
      })
      testActions.push(smokeTestsProject.action)
    }

    // Deploy to Production
    const prodHostnamePrefix = props.hostnamePrefix ? props.hostnamePrefix : `${props.namespace}-${props.instanceName}`
    const prodBuildPath = `$CODEBUILD_SRC_DIR_${appSourceArtifact.artifactName}`
    const prodBuildOutput = new Artifact('ProdBuild')
    let certificateArnPath = (props.contextEnvName === 'dev') ? "" : props.prodCertificateArnPath
    let domainNameOverride = (props.contextEnvName === 'dev') ? "" : props.prodDomainNameOverride
    let prodAdditionalAliases = props.prodAdditionalAliases
    if (!(props.namespace.includes('marble'))) {  //This should allow the marble website to be deployed to testlibnd without the error of the nd.edu certificate not working for a libraries.nd.edu domain.
      domainNameOverride = ""
      certificateArnPath = ""
      prodAdditionalAliases = ""
    }
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, prodHostnamePrefix, prodBuildPath, prodBuildOutput, 'prod', certificateArnPath, domainNameOverride, prodAdditionalAliases)

    const s3syncProdProps: IPipelineS3SyncProps = {
      targetStack: prodStackName,
      inputBuildArtifact: appSourceArtifact,
      searchIndex: `${props.searchIndex}`,
      siteDirectory: props.siteDirectory,
      workspaceName: props.workspaceName,
      graphqlApiUrlKeyPath: props.prodMaintainMetadataStack.graphqlApiUrlKeyPath,
      graphqlApiKeyKeyPath: props.prodMaintainMetadataStack.graphqlApiKeyKeyPath,
      publicGraphqlApiKeyPath: props.prodManifestLambdaStack.publicGraphqlApiKeyPath,
      buildEnvironment: 'production',
      maintainMetadataKeyBase: props.prodMaintainMetadataStack.maintainMetadataKeyBase,
      oktaClientIdField: props.oktaClientIdField,
      oktaIssuerField: props.oktaIssuerField,
      oktaSecret: props.oktaSecret,
      oktaUrl: props.oktaUrl,
      opensearchSecretsKeyPath: props.opensearchSecretsKeyPath,
    }
    if (subAppSourceArtifact !== undefined) {
      s3syncProdProps.extraBuildArtifacts = [subAppSourceArtifact]
    }
    const s3syncProd = new PipelineS3Sync(this, 'S3SyncProd', s3syncProdProps)

    const domainName = domainNameOverride || props.domainName
    const prodHostname = `${prodHostnamePrefix}.${domainName}`
    // const prodHost = StringParameter.valueForStringParameter(this, `/all/stacks/${prodStackName}/website-url`)
    
    let smokeTestsProd
    const prodActions: codepipeline.IAction[] = [deployProd.action, s3syncProd.action]
    if (props.hostedZoneTypes.includes('public')){
      smokeTestsProd = new NewmanRunner(this, 'StaticHostProdSmokeTests', {
        sourceArtifact: appSourceArtifact,
        collectionPath: props.qaSpecPath,
        collectionVariables: {
          'hostname': prodHostname,
        },
        actionName: 'SmokeTests',
      })
    prodActions.push(smokeTestsProd.action)
  }
    // Approval
    const importedSlackNotifyTopicArn = Fn.importValue(props.slackNotifyTopicOutput)
    const approvalTopic = Topic.fromTopicArn(this, 'SlackTopicFromArn', importedSlackNotifyTopicArn)
    const approvalAction = new SlackIntegratedManualApproval({
      actionName: 'ApproveTestStack',
      notificationTopic: approvalTopic,
      customData: {
        successfulTarget: `https://${testHostname}`,
        attemptTarget: `https://${prodHostname}`,
        slackChannelId: props.slackChannelId,
        slackChannelName: props.slackChannelName,
        githubSources: [
          { owner: props.appRepoOwner, sourceAction: appSourceAction },
          { owner: props.infraRepoOwner, sourceAction: infraSourceAction },
        ],
      },
    })
    testActions.push(approvalAction)

    // Pipeline
    const sources = [appSourceAction, infraSourceAction]
    if (subAppSourceAction !== undefined) {
      sources.push(subAppSourceAction)
    }
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket: props.pipelineFoundationStack.artifactBucket,
      stages: [
        {
          actions: sources,
          stageName: 'Source',
        },
        {
          actions: testActions,
          stageName: 'Test',
        },
        {
          actions: prodActions,
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
