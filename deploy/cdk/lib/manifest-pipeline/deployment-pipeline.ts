import codepipeline = require('@aws-cdk/aws-codepipeline')
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions')
import { ManualApprovalAction } from '@aws-cdk/aws-codepipeline-actions'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Topic } from '@aws-cdk/aws-sns'
import cdk = require('@aws-cdk/core')
import { SlackApproval, PipelineNotifications } from '@ndlib/ndlib-cdk'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy } from '../namespaced-policy'
import { PipelineFoundationStack } from '../foundation'

export interface IDeploymentPipelineStackProps extends cdk.StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly oauthTokenPath: string; // Note:  This is a secretstore value, not an ssm value /esu/github/ndlib-git
  readonly appRepoOwner: string;
  readonly appRepoName: string;
  readonly appSourceBranch: string;
  readonly infraRepoOwner: string;
  readonly infraRepoName: string;
  readonly infraSourceBranch: string;
  readonly namespace: string;
  readonly contextEnvName: string;
  readonly owner: string;
  readonly contact: string;
  readonly slackNotifyStackName?: string;
  readonly notificationReceivers?: string;
  readonly hostnamePrefix: string;
  readonly createDns: boolean;
  readonly sentryDsn: string;
  readonly imageServiceStackName: string;
  readonly dataProcessingKeyPath: string;
  readonly prodImageServiceStackName: string;
  readonly prodDataProcessingKeyPath: string;
}

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-manifest`
    const prodStackName = `${props.namespace}-prod-manifest`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, hostnamePrefix: string, imageServiceStackName: string, dataProcessingKeyPath: string, deployConstructName: string, createEventRules: boolean) => {
      const cdkDeploy = new CDKPipelineDeploy(this, deployConstructName, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appSourceArtifact,
        appBuildCommands: [
          'echo "Ensure that the codebuild directory is executable"',
          'chmod -R 755 ./scripts/codebuild/*',
          `export BLUEPRINTS_DIR="$CODEBUILD_SRC_DIR_${infraSourceArtifact.artifactName}"`,
          './scripts/codebuild/install.sh',
          'pyenv versions',
          './scripts/codebuild/pre_build.sh',
          'yarn',
        ],
        outputFiles: [
          `**/*`,
        ],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        contextEnvName: props.contextEnvName,
        additionalContext: {
          description: "data pipeline for IIIF Manifests",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
          sentryDsn: props.sentryDsn,
          "manifestPipeline:imageServerHostname": `/all/stacks/${imageServiceStackName}/hostname`,
          "manifestPipeline:marbleProcessingKeyPath": dataProcessingKeyPath,
          "manifestPipeline:appConfigPath": `/all/stacks/${targetStack}`,
          "manifestPipeline:lambdaCodeRootPath": `$CODEBUILD_SRC_DIR_${appSourceArtifact.artifactName}`,
          "manifestPipeline:hostnamePrefix": hostnamePrefix,
          "manifestPipeline:createEventRules": createEventRules ? "true" : "false",
        },
        additionalRuntimeEnvironments: {
          python: '3.8',
        },
      })
      //  Allow manifest-pipeline to create any bucket it needs, using its stack name as a base for the name
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.s3(targetStack))

      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources:[
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/all/stacks/' + imageServiceStackName + '/hostname'),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + dataProcessingKeyPath),
        ],
      }))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.api())
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.events(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.logstream(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))
      // Allow additional lambda layers
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['lambda:*'],
        resources: [
          cdk.Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:layer:*-manifest-layer'),
          cdk.Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:layer:*-sentry-layer'),
        ],
      }))
      // Allow target stack to describe state machines
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['states:DescribeStateMachine',
        ],
        resources: [
          cdk.Fn.sub('arn:aws:states:${AWS::Region}:${AWS::AccountId}:stateMachine:' + targetStack + '-*'),
        ],
      }))
      // Replicating manifest-pipeline-pipeline.yml to implement 178 - 186
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['states:CreateStateMachine',
          'states:DeleteStateMachine',
          'states:TagResource',
          'states:UpdateStateMachine',
        ],
        resources: [
          cdk.Fn.sub('arn:aws:states:${AWS::Region}:${AWS::AccountId}:stateMachine:*'),
        ],
      }))
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['cloudfront:CreateCloudFrontOriginAccessIdentity',
          'cloudfront:CreateDistribution',
          'cloudfront:CreateCloudFrontOriginAccessIdentity',
          'cloudfront:DeleteDistribution',
          'cloudfront:DeleteCloudFrontOriginAccessIdentity',
          'cloudfront:UpdateDistribution',
          'cloudfront:UpdateCloudFrontOriginAccessIdentity',
          'cloudfront:TagResource',
          'cloudfront:GetDistribution',
          'cloudfront:GetCloudFrontOriginAccessIdentity',
          'cloudfront:GetCloudFrontOriginAccessIdentityConfig',
        ],
        resources: [
          '*',
        ],
      }))
      // Allow the pipeline to change ACLs on the logging bucket since it deploys a Cloudfront that needs to put logs here
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          's3:PutBucketAcl',
          's3:GetBucketAcl',
        ],
        resources: [
          'arn:aws:s3:::' + props.namespace + '-test-foundation-log*',
          'arn:aws:s3:::' + props.namespace + '-prod-foundation-log*',
          'arn:aws:s3:::' + props.namespace + '-foundation-log*',
        ],
      }))
      // Allow rout53 DNS access
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: [
          'route53:GetHostedZone',
          'route53:ChangeResourceRecordSets',
          'route53:GetChange',
        ],
        resources: [
          `arn:aws:route53:::hostedzone/*`,
          'arn:aws:route53:::change/*',
        ],
      }))

      if(props.createDns){
        cdkDeploy.project.addToRolePolicy(NamespacedPolicy.route53RecordSet('*'))
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
    })
    const infraSourceArtifact = new codepipeline.Artifact('InfraCode')
    const infraSourceAction = new codepipelineActions.GitHubSourceAction({
        actionName: 'InfraCode',
        branch: props.infraSourceBranch,
        oauthToken: cdk.SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
        output: infraSourceArtifact,
        owner: props.infraRepoOwner,
        repo: props.infraRepoName,
    })

    // Deploy to Test
    const testHostnamePrefix = `${props.hostnamePrefix}-test`
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, testHostnamePrefix, props.imageServiceStackName, props.dataProcessingKeyPath, `${props.namespace}-manifest-deploy-test`, false)

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
      new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    // Deploy to Production
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, props.hostnamePrefix, props.prodImageServiceStackName, props.prodDataProcessingKeyPath, `${props.namespace}-manifest-deploy-prod`, true)

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