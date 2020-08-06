import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions');
import { ManualApprovalAction } from '@aws-cdk/aws-codepipeline-actions';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Bucket, BucketEncryption } from '@aws-cdk/aws-s3';
import { Topic } from '@aws-cdk/aws-sns';
import cdk = require('@aws-cdk/core');
import { SlackApproval, PipelineNotifications } from '@ndlib/ndlib-cdk';
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy';
import { NamespacedPolicy, GlobalActions } from '../namespaced-policy';


export interface IDeploymentPipelineStackProps extends cdk.StackProps {
  readonly oauthTokenPath: string;
  readonly namespace: string;
  readonly owner: string;
  readonly contact: string;
  readonly esDomainName: string;
  readonly infraRepoOwner: string;
  readonly infraRepoName: string;
  readonly infraSourceBranch: string;
  readonly slackNotifyStackName?: string;
  readonly notificationReceivers?: string;
};

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props);

    const testStackName = `${props.namespace}-test-elastic`;
    const prodStackName = `${props.namespace}-prod-elastic`;

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, domainName: string) => {
      const cdkDeploy = new CDKPipelineDeploy(this, `${namespace}-deploy`, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appBuildCommands: [],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        additionalContext: {
          description: "Elasticsearch cluster",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
          "elasticsearch:esDomainName": domainName,
        },
      });
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.elasticsearch(domainName));
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack));
      cdkDeploy.project.addToRolePolicy(
        NamespacedPolicy.globals([GlobalActions.Cloudwatch,GlobalActions.ES]));
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack));
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.sns(targetStack));

      return cdkDeploy;
    }

    const artifactBucket = new Bucket(this, 'artifactBucket', { 
      encryption: BucketEncryption.KMS_MANAGED, 
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Source Actions
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
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, `test-${props.esDomainName}`);

    // Approval
    const approvalTopic = new Topic(this, 'ApprovalTopic');
    const approvalAction = new ManualApprovalAction({
      actionName: 'Approval',
      additionalInformation: `A new version of elasticsearch has been deployed to stack '${testStackName}' and is awaiting your approval. If you approve these changes, they will be deployed to stack '${prodStackName}'.`,
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
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, `prod-${props.esDomainName}`);

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeploymentPipeline', {
      artifactBucket,
      stages: [
        {
          actions: [infraSourceAction],
          stageName: 'Source',
        },
        {
          actions: [deployTest.action, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action],
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