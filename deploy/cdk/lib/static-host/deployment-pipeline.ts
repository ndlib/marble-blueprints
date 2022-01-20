import codepipeline = require('@aws-cdk/aws-codepipeline')
import { Artifact } from '@aws-cdk/aws-codepipeline'
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions')
import { GitHubTrigger } from '@aws-cdk/aws-codepipeline-actions'
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam'
import { Topic } from '@aws-cdk/aws-sns'
import cdk = require('@aws-cdk/core')
import { NewmanRunner, PipelineNotifications, SlackApproval } from '@ndlib/ndlib-cdk'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { FoundationStack, PipelineFoundationStack } from '../foundation'
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'
import { IPipelineS3SyncProps, PipelineS3Sync } from './pipeline-s3-sync'
import { OpenSearchStack } from '../opensearch'
import { MaintainMetadataStack } from '../maintain-metadata'
import { ManifestLambdaStack } from '../manifest-lambda'
import { GithubApproval } from '../github-approval'

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
  readonly createDns: boolean
  readonly prodOpenSearchStack: OpenSearchStack
  readonly searchIndex: string
  readonly siteDirectory: string
  readonly workspaceName: string
  readonly submoduleRepoName?: string
  readonly submoduleSourceBranch?: string
  readonly prodCertificateArnPath?: string
  readonly prodDomainNameOverride?: string
  readonly prodAdditionalAliases?: string
  readonly testMaintainMetadataStack: MaintainMetadataStack
  readonly prodMaintainMetadataStack: MaintainMetadataStack
  readonly testManifestLambdaStack: ManifestLambdaStack
  readonly prodManifestLambdaStack: ManifestLambdaStack
  readonly authClientUrl: string
  readonly authClientId: string
  readonly authClientIssuer: string
}

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-${props.instanceName}`
    const prodStackName = `${props.namespace}-prod-${props.instanceName}`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, hostnamePrefix: string, buildPath: string, outputArtifact: Artifact, foundationStack: FoundationStack,
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
      ]))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.s3(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.opensearchInvoke(props.namespace))  // Because the domainName isn't available at synth time, and because the domain names start with the namespace name, I'll use the namespace name here to grant access to all domains starting with this namespace name
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.testMaintainMetadataStack.maintainMetadataKeyBase + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodMaintainMetadataStack.maintainMetadataKeyBase + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.testManifestLambdaStack.publicGraphqlApiKeyPath + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodManifestLambdaStack.publicGraphqlApiKeyPath + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodOpenSearchStack.domainNameKeyPath + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodOpenSearchStack.domainEndpointKeyPath + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodOpenSearchStack.domainMasterUserNameKeyPath + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodOpenSearchStack.domainMasterUserNameKeyPath + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodOpenSearchStack.domainReadOnlyUserNameKeyPath + '*'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.prodOpenSearchStack.domainReadOnlyPasswordKeyPath + '*'),
        ],
        actions: ["ssm:Get*"],
      }))

      if (props.createDns) {
        cdkDeploy.project.addToRolePolicy(NamespacedPolicy.route53RecordSet(foundationStack.hostedZone.hostedZoneId))
      }

      if (certificateArnPath) {
        cdkDeploy.project.addToRolePolicy(new PolicyStatement({
          actions: [
            'ssm:GetParameters',
          ],
          resources: [
            cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + certificateArnPath),
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
        oauthToken: cdk.SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
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
          oauthToken: cdk.SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
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
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, testHostnamePrefix, testBuildPath, testBuildOutput, props.testFoundationStack)
    const s3syncTestProps: IPipelineS3SyncProps = {
      targetStack: testStackName,
      inputBuildArtifact: appSourceArtifact,
      searchIndex: `${props.searchIndex}-test`,
      siteDirectory: props.siteDirectory,
      workspaceName: props.workspaceName,
      openSearchDomainNameKeyPath: props.prodOpenSearchStack.domainNameKeyPath,
      openSearchEndpointKeyPath: props.prodOpenSearchStack.domainEndpointKeyPath,
      openSearchMasterUserNameKeyPath: props.prodOpenSearchStack.domainMasterUserNameKeyPath,
      openSearchMasterPasswordKeyPath: props.prodOpenSearchStack.domainMasterPasswordKeyPath,
      openSearchReadOnlyUserNameKeyPath: props.prodOpenSearchStack.domainReadOnlyUserNameKeyPath,
      openSearchReadOnlyPasswordKeyPath: props.prodOpenSearchStack.domainReadOnlyPasswordKeyPath,
      openSearchDomainPrefix: props.namespace,
      graphqlApiUrlKeyPath: props.testMaintainMetadataStack.graphqlApiUrlKeyPath,
      graphqlApiKeyKeyPath: props.testMaintainMetadataStack.graphqlApiKeyKeyPath,
      publicGraphqlApiKeyPath: props.testManifestLambdaStack.publicGraphqlApiKeyPath,
      buildEnvironment: 'test',
      maintainMetadataKeyBase: props.testMaintainMetadataStack.maintainMetadataKeyBase,
      authClientUrl: props.authClientUrl,
      authClientId: props.authClientId,
      authClientIssuer: props.authClientIssuer,
    }
    if (subAppSourceArtifact !== undefined) {
      s3syncTestProps.extraBuildArtifacts = [subAppSourceArtifact]
    }
    const s3syncTest = new PipelineS3Sync(this, 'S3SyncTest', s3syncTestProps)

    const testHostname = `${testHostnamePrefix}.${props.testFoundationStack.hostedZone.zoneName}`
    const smokeTestsProject = new NewmanRunner(this, 'StaticHostSmokeTests', {
      sourceArtifact: appSourceArtifact,
      collectionPath: props.qaSpecPath,
      collectionVariables: {
        'hostname': testHostname,
      },
      actionName: 'SmokeTests',
    })

    // Deploy to Production
    const prodHostnamePrefix = props.hostnamePrefix ? props.hostnamePrefix : `${props.namespace}-${props.instanceName}`
    const prodBuildPath = `$CODEBUILD_SRC_DIR_${appSourceArtifact.artifactName}`
    const prodBuildOutput = new Artifact('ProdBuild')
    const certificateArnPath = (props.contextEnvName === 'dev') ? "" : props.prodCertificateArnPath
    const domainNameOverride = (props.contextEnvName === 'dev') ? "" : props.prodDomainNameOverride
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, prodHostnamePrefix, prodBuildPath, prodBuildOutput, props.prodFoundationStack, certificateArnPath, domainNameOverride, props.prodAdditionalAliases)

    const s3syncProdProps: IPipelineS3SyncProps = {
      targetStack: prodStackName,
      inputBuildArtifact: appSourceArtifact,
      searchIndex: `${props.searchIndex}-prod`,
      siteDirectory: props.siteDirectory,
      workspaceName: props.workspaceName,
      openSearchDomainNameKeyPath: props.prodOpenSearchStack.domainNameKeyPath,
      openSearchEndpointKeyPath: props.prodOpenSearchStack.domainEndpointKeyPath,
      openSearchMasterUserNameKeyPath: props.prodOpenSearchStack.domainMasterUserNameKeyPath,
      openSearchMasterPasswordKeyPath: props.prodOpenSearchStack.domainMasterPasswordKeyPath,
      openSearchReadOnlyUserNameKeyPath: props.prodOpenSearchStack.domainReadOnlyUserNameKeyPath,
      openSearchReadOnlyPasswordKeyPath: props.prodOpenSearchStack.domainReadOnlyPasswordKeyPath,
      openSearchDomainPrefix: props.namespace,
      graphqlApiUrlKeyPath: props.prodMaintainMetadataStack.graphqlApiUrlKeyPath,
      graphqlApiKeyKeyPath: props.prodMaintainMetadataStack.graphqlApiKeyKeyPath,
      publicGraphqlApiKeyPath: props.prodManifestLambdaStack.publicGraphqlApiKeyPath,
      buildEnvironment: 'production',
      maintainMetadataKeyBase: props.prodMaintainMetadataStack.maintainMetadataKeyBase,
      authClientUrl: props.authClientUrl,
      authClientId: props.authClientId,
      authClientIssuer: props.authClientIssuer,
    }
    if (subAppSourceArtifact !== undefined) {
      s3syncProdProps.extraBuildArtifacts = [subAppSourceArtifact]
    }
    const s3syncProd = new PipelineS3Sync(this, 'S3SyncProd', s3syncProdProps)

    const domainName = domainNameOverride || props.prodFoundationStack.hostedZone.zoneName
    const prodHostname = `${prodHostnamePrefix}.${domainName}`
    const smokeTestsProd = new NewmanRunner(this, 'StaticHostProdSmokeTests', {
      sourceArtifact: appSourceArtifact,
      collectionPath: props.qaSpecPath,
      collectionVariables: {
        'hostname': prodHostname,
      },
      actionName: 'SmokeTests',
    })

    // Approval
    const approvalTopic = new Topic(this, 'ApprovalTopic')
    const approvalAction = new GithubApproval({
      notificationTopic: approvalTopic,
      testTarget: `https://${testHostname}`,
      prodTarget: `https://${prodHostname}`,
      githubSources: [
        { owner: props.appRepoOwner, sourceAction: appSourceAction },
        { owner: props.infraRepoOwner, sourceAction: infraSourceAction },
      ],
    })
    if (props.slackNotifyStackName !== undefined) {
      new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

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
          actions: [deployTest.action, s3syncTest.action, smokeTestsProject.action, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action, s3syncProd.action, smokeTestsProd.action],
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
