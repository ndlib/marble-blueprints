import { BuildEnvironmentVariableType, BuildSpec, PipelineProject } from 'aws-cdk-lib/aws-codebuild'
import codepipeline = require('aws-cdk-lib/aws-codepipeline')
import codepipelineActions = require('aws-cdk-lib/aws-codepipeline-actions')
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
// import cdk = require('aws-cdk-lib')
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { CodeBuildAction, GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions'
import { FoundationStack, PipelineFoundationStack } from '../foundation'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { Fn, SecretValue, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from "constructs"
import { SlackApproval, NewmanRunner, PipelineNotifications } from '@ndlib/ndlib-cdk2'
import { GithubApproval } from '../github-approval'

export interface IDeploymentPipelineStackProps extends StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly oauthTokenPath: string;
  readonly appRepoOwner: string;
  readonly appRepoName: string;
  readonly appSourceBranch: string;
  readonly infraRepoOwner: string;
  readonly infraRepoName: string;
  readonly infraSourceBranch: string;
  readonly qaRepoOwner: string;
  readonly qaRepoName: string;
  readonly qaSourceBranch: string;
  readonly namespace: string;
  readonly contextEnvName: string;
  readonly owner: string;
  readonly contact: string;
  readonly testFoundationStack: FoundationStack;
  readonly prodFoundationStack: FoundationStack;
  readonly hostnamePrefix: string;
  readonly createDns: boolean;
  readonly createGithubWebhooks: boolean;
  readonly slackNotifyStackName?: string;
  readonly notificationReceivers?: string;
  readonly paramPathPrefix: string;
  readonly dockerhubCredentialsPath: string;
}

export class DeploymentPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const appRepoUrl = `https://github.com/${props.appRepoOwner}/${props.appRepoName}`
    const infraRepoUrl = `https://github.com/${props.infraRepoOwner}/${props.infraRepoName}`
    const testHost = `${props.hostnamePrefix}-test.${props.testFoundationStack.hostedZone.zoneName}`
    const testStackName = `${props.namespace}-test-image-service`
    const prodHost = `${props.hostnamePrefix}.${props.prodFoundationStack.hostedZone.zoneName}`
    const prodStackName = `${props.namespace}-prod-image-service`

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
    const qaSourceArtifact = new codepipeline.Artifact('QACode')
    const qaSourceAction = new codepipelineActions.GitHubSourceAction({
      actionName: 'QACode',
      branch: props.qaSourceBranch,
      oauthToken: SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
      output: qaSourceArtifact,
      owner: props.qaRepoOwner,
      repo: props.qaRepoName,
      trigger: props.createGithubWebhooks ? GitHubTrigger.WEBHOOK : GitHubTrigger.POLL,
    })
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

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, hostnamePrefix: string, paramPath: string, foundationStack: FoundationStack) => {
      const fqdn = `${hostnamePrefix}.${foundationStack.hostedZone.zoneName}`
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appSourceArtifact,
        appBuildCommands: [
          'cd $CODEBUILD_SRC_DIR_AppCode/src',
          'npm install',
        ],
        cdkDirectory: 'deploy/cdk',
        namespace,
        contextEnvName: props.contextEnvName,
        dockerhubCredentialsPath: props.dockerhubCredentialsPath,
        additionalContext: {
          description: "IIIF Serverless API",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
          "iiifImageService:serverlessIiifSrcPath": "$CODEBUILD_SRC_DIR_AppCode",
          "iiifImageService:hostnamePrefix": hostnamePrefix,
          "iiifImageService:paramPathPrefix": paramPath,
          "createDns": props.createDns ? "true" : "false",
        },
      })

      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.transform())
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.api())
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(`${namespace}-foundation`))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.apiDomain(fqdn))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.globals([GlobalActions.Cloudfront, GlobalActions.Route53]))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
      // TODO: For some reason the dependencies layer doesn't get the stack name when deployed through this pipeline
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        resources: [Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:layer:Dependencies*')],
        actions: ['lambda:*'],
      }))
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources: [
          Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + paramPath + '/*'),
        ],
      }))

      if (props.createDns) {
        cdkDeploy.project.addToRolePolicy(NamespacedPolicy.route53RecordSet(foundationStack.hostedZone.hostedZoneId))
      }
      return cdkDeploy
    }
    // Project for copying test images into the public buckets
    const copyImagesProject = new PipelineProject(this, 'CopyImages', {
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              `aws s3 cp --recursive images s3://$TARGET_IMAGE_BUCKET/tests/`,
            ],
          },
        },
      }),
    })
    copyImagesProject.addToRolePolicy(new PolicyStatement({
      resources: [
        props.testFoundationStack.publicBucket.arnForObjects('*'),
        props.prodFoundationStack.publicBucket.arnForObjects('*'),
      ],
      actions: [
        's3:Abort*',
        's3:DeleteObject*',
        's3:PutObject*',
        's3:CreateMultipartUpload*',
      ],
    }))

    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, `${props.hostnamePrefix}-test`, `${props.paramPathPrefix}/test`, props.testFoundationStack)
    const copyImagesTestAction = new CodeBuildAction({
      actionName: 'CopyImages',
      project: copyImagesProject,
      input: qaSourceArtifact,
      environmentVariables: {
        TARGET_IMAGE_BUCKET: {
          value: props.testFoundationStack.publicBucket.bucketName,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
      },
    })
    const smokeTestsProject = new NewmanRunner(this, 'IIIFServerlessSmokeTests', {
      sourceArtifact: qaSourceArtifact,
      collectionPath: 'newman/smoke.json',
      collectionVariables: {
        'image-server-host': testHost,
      },
      actionName: 'SmokeTests',
    })

    // Approval
    const approvalTopic = new Topic(this, 'ApprovalTopic')
    const approvalAction = new GithubApproval({
      notificationTopic: approvalTopic,
      testTarget: `https://${testHost}`,
      prodTarget: `https://${prodHost}`,
      githubSources: [
        { owner: props.appRepoOwner, sourceAction: appSourceAction },
        { owner: props.infraRepoOwner, sourceAction: infraSourceAction },
      ],
    })
    if (props.slackNotifyStackName !== undefined) {
      const slackApproval = new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, `${props.hostnamePrefix}`, `${props.paramPathPrefix}/prod`, props.prodFoundationStack)
    const copyImagesProdAction = new CodeBuildAction({
      actionName: 'CopyImages',
      project: copyImagesProject,
      input: qaSourceArtifact,
      environmentVariables: {
        TARGET_IMAGE_BUCKET: {
          value: props.prodFoundationStack.publicBucket.bucketName,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
      },
    })
    const smokeTestsProdProject = new NewmanRunner(this, 'IIIFServerlessSmokeTestsProd', {
      sourceArtifact: qaSourceArtifact,
      collectionPath: 'newman/smoke.json',
      collectionVariables: {
        'image-server-host': prodHost,
      },
      actionName: 'SmokeTests',
    })

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket: props.pipelineFoundationStack.artifactBucket,
      stages: [
        {
          actions: [appSourceAction, qaSourceAction, infraSourceAction],
          stageName: 'Source',
        },
        {
          actions: [deployTest.action, copyImagesTestAction, smokeTestsProject.action, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action, copyImagesProdAction, smokeTestsProdProject.action],
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
