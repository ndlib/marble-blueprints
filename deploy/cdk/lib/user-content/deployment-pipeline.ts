import { BuildSpec, LinuxBuildImage, PipelineProject } from '@aws-cdk/aws-codebuild';
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions');
import { ManualApprovalAction } from '@aws-cdk/aws-codepipeline-actions';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Bucket, BucketEncryption } from '@aws-cdk/aws-s3';
import { Topic } from '@aws-cdk/aws-sns';
import cdk = require('@aws-cdk/core');
import { SlackApproval, PipelineNotifications } from '@ndlib/ndlib-cdk';
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy';
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
  readonly allowedOrigins: string;
  readonly notificationReceivers?: string;
  readonly domainStackName: string;
  readonly hostnamePrefix: string;
  readonly createDns: boolean;
};

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props);

    const testStackName = `${props.namespace}-test-user-content`;
    const prodStackName = `${props.namespace}-prod-user-content`;

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, outputArtifact: Artifact, hostnamePrefix: string) => {
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appSourceArtifact,
        appBuildCommands: [
          'yarn',
          'cd src',
          'yarn',
        ],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        additionalContext: {
          description: "User content API",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
          "userContent:lambdaCodePath": "$CODEBUILD_SRC_DIR_AppCode/src",
          "userContent:allowedOrigins": props.allowedOrigins,
          "userContent:hostnamePrefix": hostnamePrefix,
          "domainStackName": props.domainStackName,
          "createDns": props.createDns ? "true" : "false",
        },
        postDeployCommands: [
          // This API isn't using DNS, and the endpoint isn't created until the deploy command completes,
          // so we have to do a lookup here at execution time and pass it to the next test stage instead
          // of importing it. If we change this app to create the test/prod stacks as a precondition to
          // deploying the pipeline, then we can change this to just import it.
          `aws cloudformation describe-stacks \
            --stack-name ${targetStack} \
            --query 'Stacks[].Outputs[?contains(OutputKey,\`userContentApiEndpoint\`)].OutputValue' \
            --output text > $CODEBUILD_SRC_DIR/apiEndpoint.txt`,
        ],
        outputFiles: ['apiEndpoint.txt'],
        outputArtifacts: [outputArtifact],
      });
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources:[
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.tokenAudiencePath), 
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.tokenIssuerPath),
        ],
      }));
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.api());
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.dynamodb(targetStack));
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack));
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack));

      if(props.createDns){
        const hostedZone = Fn.importValue(`${props.domainStackName}:Zone`);
        cdkDeploy.project.addToRolePolicy(NamespacedPolicy.route53RecordSet(hostedZone));
      }
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
    const testOutputArtifact = new codepipeline.Artifact('TestDeploy');
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, testOutputArtifact, `${props.hostnamePrefix}-test`);
    const smokeTestsProject = new PipelineProject(this, 'MarbleUserContentSmokeTests', {
      buildSpec: BuildSpec.fromObject({
        phases: {
          pre_build: {
            commands: [
              'cat $CODEBUILD_SRC_DIR_TestDeploy/apiEndpoint.txt',
              'apiEndpoint=$(cat $CODEBUILD_SRC_DIR_TestDeploy/apiEndpoint.txt)'
            ]
          },
          build: {
            commands: [
              'newman run tests/postman/collection.json --folder Smoke --env-var api=$apiEndpoint'
            ],
          },
        },
        version: '0.2',
      }),
      environment: {
        buildImage: LinuxBuildImage.fromDockerRegistry('postman/newman'),
      },
    });
    const smokeTestsAction = new codepipelineActions.CodeBuildAction({
      input: appSourceArtifact,
      extraInputs: [testOutputArtifact],
      project: smokeTestsProject,
      actionName: 'SmokeTests',
      runOrder: 98,
    });

    // Approval
    const appRepoUrl = `https://github.com/${props.appRepoOwner}/${props.appRepoName}`;
    const approvalTopic = new Topic(this, 'ApprovalTopic');
    const approvalAction = new ManualApprovalAction({
      actionName: 'Approval',
      additionalInformation: `A new version of ${appRepoUrl} has been deployed to stack '${testStackName}' and is awaiting your approval. If you approve these changes, they will be deployed to stack '${prodStackName}'.`,
      notificationTopic: approvalTopic,
      runOrder: 99, // This should always be the last action in the stage
    });
    if(props.slackNotifyStackName !== undefined){
      const slackApproval = new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      });
    }

    // Deploy to Production
    const prodOutputArtifact = new codepipeline.Artifact('ProdDeploy');
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, prodOutputArtifact, props.hostnamePrefix);
    const smokeTestsProdProject = new PipelineProject(this, 'MarbleUserContentProdSmokeTests', {
      buildSpec: BuildSpec.fromObject({
        phases: {
          pre_build: {
            commands: [
              'cat $CODEBUILD_SRC_DIR_ProdDeploy/apiEndpoint.txt',
              'apiEndpoint=$(cat $CODEBUILD_SRC_DIR_ProdDeploy/apiEndpoint.txt)'
            ]
          },
          build: {
            commands: [
              'newman run tests/postman/collection.json --folder Smoke --env-var api=$apiEndpoint'
            ],
          },
        },
        version: '0.2',
      }),
      environment: {
        buildImage: LinuxBuildImage.fromDockerRegistry('postman/newman'),
      },
    });
    const smokeTestsProdAction = new codepipelineActions.CodeBuildAction({
      input: appSourceArtifact,
      extraInputs: [prodOutputArtifact],
      project: smokeTestsProdProject,
      actionName: 'SmokeTests',
      runOrder: 98,
    });

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket,
      stages: [
        {
          actions: [appSourceAction, infraSourceAction],
          stageName: 'Source',
        },
        {
          actions: [deployTest.action, smokeTestsAction, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action, smokeTestsProdAction],
          stageName: 'Production',
        }
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