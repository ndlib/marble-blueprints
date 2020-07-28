import { BuildSpec, LinuxBuildImage, PipelineProject } from '@aws-cdk/aws-codebuild';
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions');
import { ManualApprovalAction } from '@aws-cdk/aws-codepipeline-actions';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Bucket, BucketEncryption } from '@aws-cdk/aws-s3';
import { Topic } from '@aws-cdk/aws-sns';
import cdk = require('@aws-cdk/core');
import { SlackApproval, PipelineNotifications } from '@ndlib/ndlib-cdk';
import { CDKRedDeploy } from '../cdk-red-deploy';
import { NamespacedPolicy } from '../namespaced-policy';
import { Artifact } from '@aws-cdk/aws-codepipeline';
import { Fn } from '@aws-cdk/core';

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
  readonly tokenAudiencePath: string;
  readonly tokenIssuerPath: string;
  readonly slackNotifyStackName?: string;
  readonly notificationReceivers?: string;
};

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props);

    const testStackName = `${props.namespace}-test-image`;
    const prodStackName = `${props.namespace}-prod-image`;

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string) => {
      const cdkDeploy = new CDKRedDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appSourceArtifact,
        appBuildCommands: [],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        additionalContext: {
          description: "Image processing",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
          lambdaCodePath: "$CODEBUILD_SRC_DIR_AppCode/s3_event",
          dockerfilePath: "$CODEBUILD_SRC_DIR_AppCode/",
        },
      });
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources:[
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.tokenAudiencePath), 
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.tokenIssuerPath),
        ],
      }));
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack));
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack));

      return cdkDeploy;
    }

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

    // Deploy to Test
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`);

    console.log("UNCOMMENT APPROVAL STEP")
    // Approval
    // const appRepoUrl = `https://github.com/${props.appRepoOwner}/${props.appRepoName}`;
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

    // Deploy to Production
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
          actions: [deployTest.action],
          stageName: 'Test',
        },
        // {
        //   actions: [deployProd.action],
        //   stageName: 'Production',
        // }
      ],
    });
    if(props.notificationReceivers){
      const notifications = new PipelineNotifications(this, 'PipelineNotifications', {
        pipeline,
        receivers: props.notificationReceivers,
      });
    }
  }
}