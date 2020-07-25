import { BuildSpec, LinuxBuildImage, PipelineProject, BuildEnvironmentVariableType } from '@aws-cdk/aws-codebuild';
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions');
import { ManualApprovalAction } from '@aws-cdk/aws-codepipeline-actions';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Bucket, BucketEncryption } from '@aws-cdk/aws-s3';
import cdk = require('@aws-cdk/core');
import { CloudFormationCapabilities } from '@aws-cdk/aws-cloudformation';


export interface IDeploymentPipelineStackProps extends cdk.StackProps {
  readonly oauthTokenPath: string;
  readonly appRepoOwner: string;
  readonly appRepoName: string;
  readonly appSourceBranch: string;
  readonly infraRepoOwner: string;
  readonly infraRepoName: string;
  readonly infraSourceBranch: string;
  readonly namespace: string;
  readonly owner: string;
  readonly contact: string;
  readonly slackNotifyStackName?: string;
  readonly notificationReceivers?: string;
  readonly domainStackName: string;
};

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props);

    const appRepoUrl = `https://github.com/${props.appRepoOwner}/${props.appRepoName}`;
    const infraRepoUrl = `https://github.com/${props.infraRepoOwner}/${props.infraRepoName}`;
    const testStackName = `${props.namespace}-image-test`;
    const prodStackName = `${props.namespace}-image-prod`;

    const artifactBucket = new Bucket(this, 'artifactBucket', { 
      encryption: BucketEncryption.KMS_MANAGED, 
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Source Actions
    const appSourceArtifact = new codepipeline.Artifact('AppCode');
    const appSourceAction = new codepipelineActions.GitHubSourceAction({
        actionName: 'AppCode',
        branch: props.appSourceBranch,
        oauthToken: cdk.SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
        output: appSourceArtifact,
        owner: props.appRepoOwner,
        repo: props.appRepoName,
    });
    const infraSourceArtifact = new codepipeline.Artifact('InfraCode');
    const infraSourceAction = new codepipelineActions.GitHubSourceAction({
        actionName: 'InfraCode',
        branch: props.infraSourceBranch,
        oauthToken: cdk.SecretValue.secretsManager(props.oauthTokenPath, { jsonField: 'oauth' }),
        output: infraSourceArtifact,
        owner: props.infraRepoOwner,
        repo: props.infraRepoName,
    });

    const builtCodeArtifact = new codepipeline.Artifact('BuiltCode');
    const build = new PipelineProject(this, 'ImageProcessingBuild', {
      environment: {
        buildImage: LinuxBuildImage.STANDARD_4_0,
        privileged: true,
        environmentVariables: {
          STACK_NAME: {
            value: testStackName,
            type: BuildEnvironmentVariableType.PLAINTEXT,
          },
          CI: {
            value: 'true',
            type: BuildEnvironmentVariableType.PLAINTEXT,
          },
          CONTACT: {
            value: props.contact,
            type: BuildEnvironmentVariableType.PLAINTEXT,
          },
          OWNER: {
            value: props.owner,
            type: BuildEnvironmentVariableType.PLAINTEXT,
          },
        },
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'yarn install',
            ],
          },
          build: {
            commands: [
              'cd $CODEBUILD_SRC_DIR',
              'echo FOO',
              'echo $CODEBUILD_SRC_DIR_AppCode',
              'echo MOVE',
              'echo $CODEBUILD_SRC_DIR_InfraCode',
              'ls -ld $CODEBUILD_SRC_DIR_InfraCode/*',
              'ls -ld $CODEBUILD_SRC_DIR_InfraCode/deploy/cdk/lib/image-processing/*',
              'echo TRIAL_1',
              `aws cloudformation package \
                --template-file ./template.yml \
                --s3-bucket ${artifactBucket.bucketName} \
                --s3-prefix 'CloudformationPackages' \
                --output-template-file package_output.yml`,
            ]
          },
        },
        artifacts: {
          files: ['package_output.yml']
        }
      }),
    });
    build.addToRolePolicy(new PolicyStatement({
      actions: [
        's3:ListBucket',
        's3:GetObject',
        's3:PutObject',
      ],
      resources: [artifactBucket.bucketArn]
    }));
    const buildAction = new codepipelineActions.CodeBuildAction({
      actionName: 'Build',
      input: appSourceArtifact,
      extraInputs: [infraSourceArtifact],
      outputs: [builtCodeArtifact],
      project: build,
    });
    const builtTemplatePath = new codepipeline.ArtifactPath(builtCodeArtifact, 'package_output.yml');
    const deployTestAction = new codepipelineActions.CloudFormationCreateUpdateStackAction({
      actionName: 'Deploy',
      templatePath: builtTemplatePath,
      stackName: testStackName,
      adminPermissions: false,
      capabilities: [
        CloudFormationCapabilities.AUTO_EXPAND,
        CloudFormationCapabilities.ANONYMOUS_IAM,
      ],
      runOrder: 1,
    });

    // Approval
    // const approvalTopic = new Topic(this, 'ApprovalTopic');
    // const approvalAction = new ManualApprovalAction({
    //   actionName: 'Approval',
    //   additionalInformation: `A new version of ${appRepoUrl} has been deployed to stack '${testStackName}' and is awaiting your approval. If you approve these changes, they will be deployed to stack '${prodStackName}'.`,
    //   notificationTopic: approvalTopic,
    //   runOrder: 99, // This should always be the last action in the stage
    // });
    // if(props.slackNotifyStackName !== undefined){
    //   const slackApproval = new SlackApproval(this, 'SlackApproval', {
    //     approvalTopic,
    //     notifyStackName: props.slackNotifyStackName,
    //   });
    // }

    // // Deploy to Production
    // const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`);

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket,
      stages: [
        {
          actions: [appSourceAction, infraSourceAction],
          stageName: 'Source',
        },
        {
          actions: [buildAction],
          stageName: 'Build',
        },
        {
          actions: [deployTestAction],
          stageName: 'Test',
        },
      ],
    });
    // if(props.notificationReceivers){
    //   const notifications = new PipelineNotifications(this, 'PipelineNotifications', {
    //     pipeline,
    //     receivers: props.notificationReceivers,
    //   });
    // }
  }
}