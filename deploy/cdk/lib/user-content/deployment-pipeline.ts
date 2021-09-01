import { BuildEnvironmentVariableType, BuildSpec, LinuxBuildImage, PipelineProject } from '@aws-cdk/aws-codebuild'
import codepipeline = require('@aws-cdk/aws-codepipeline')
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions')
import { ManualApprovalAction, GitHubTrigger } from '@aws-cdk/aws-codepipeline-actions'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Topic } from '@aws-cdk/aws-sns'
import cdk = require('@aws-cdk/core')
import { SlackApproval, PipelineNotifications, NewmanRunner } from '@ndlib/ndlib-cdk'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy } from '../namespaced-policy'
import { FoundationStack, PipelineFoundationStack } from '../foundation'
import { DockerhubImage } from '../dockerhub-image'

export interface IDeploymentPipelineStackProps extends cdk.StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack
  readonly oauthTokenPath: string;
  readonly appRepoOwner: string;
  readonly appRepoName: string;
  readonly appSourceBranch: string;
  readonly infraRepoOwner: string;
  readonly infraRepoName: string;
  readonly infraSourceBranch: string;
  readonly createGithubWebhooks: boolean;
  readonly namespace: string;
  readonly contextEnvName: string;
  readonly owner: string;
  readonly contact: string;
  readonly tokenAudiencePath: string;
  readonly tokenIssuerPath: string;
  readonly slackNotifyStackName?: string;
  readonly allowedOrigins: string;
  readonly notificationReceivers?: string;
  readonly testFoundationStack: FoundationStack
  readonly prodFoundationStack: FoundationStack
  readonly hostnamePrefix: string;
  readonly createDns: boolean;
}

export class DeploymentPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-user-content`
    const prodStackName = `${props.namespace}-prod-user-content`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, hostnamePrefix: string, foundationStack: FoundationStack) => {
      const domainName = `${hostnamePrefix}.${foundationStack.hostedZone.zoneName}`
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
        contextEnvName: props.contextEnvName,
        additionalContext: {
          description: "User content API",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
          "userContent:lambdaCodePath": "$CODEBUILD_SRC_DIR_AppCode/src",
          "userContent:allowedOrigins": props.allowedOrigins,
          "userContent:hostnamePrefix": hostnamePrefix,
          "createDns": props.createDns ? "true" : "false",
        },
      })
      cdkDeploy.project.addToRolePolicy(new PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources:[
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.tokenAudiencePath),
          cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.tokenIssuerPath),
        ],
      }))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.api())
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.apiDomain(domainName))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.dynamodb(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))

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
    const testHostnamePrefix = `${props.hostnamePrefix}-test`
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, testHostnamePrefix, props.testFoundationStack)
    const testHostname = `https://${testHostnamePrefix}.` + props.testFoundationStack.hostedZone.zoneName
    const addDataProject = new PipelineProject(this, 'MarbleUserContentAddTestData', {
      buildSpec: BuildSpec.fromObject({
        phases: {
          build: {
            commands: [
              'echo Populating tables with test data',
              `aws dynamodb put-item --region us-east-1 --table-name $COLLECTIONS_TABLE \
                 --item '{ "userName": { "S": "tester" }, "uuid": { "S": "test-collection" }}'`,
              `aws dynamodb put-item --region us-east-1 --table-name $ITEMS_TABLE \
                 --item '{"collection":{"S":"test-collection"},"title":{"S":"Test Item"},"uuid":{"S":"test-item"}}'`,
              `aws dynamodb put-item --region us-east-1 --table-name $USERS_TABLE \
                 --item '{"userName":{"S":"tester"},"uuid":{"S":"tester"}}'`,
            ],
          },
        },
        version: '0.2',
      }),
    })
    addDataProject.addToRolePolicy(new PolicyStatement({
      actions: [ 'dynamodb:PutItem' ],
      resources: [ `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.namespace}-*` ],
    }))
    addDataProject.addToRolePolicy(NamespacedPolicy.ssm(testStackName))
    addDataProject.addToRolePolicy(NamespacedPolicy.ssm(prodStackName))

    const addTestDataAction = new codepipelineActions.CodeBuildAction({
      input: appSourceArtifact,
      project: addDataProject,
      actionName: 'AddData',
      runOrder: 97,
      environmentVariables: {
        ITEMS_TABLE: {
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
          value: `/all/stacks/${testStackName}/items-tablename`,
        },
        COLLECTIONS_TABLE: {
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
          value: `/all/stacks/${testStackName}/collections-tablename`,
        },
        USERS_TABLE: {
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
          value: `/all/stacks/${testStackName}/users-tablename`,
        },
      },
    })
    const smokeTestsProject = new NewmanRunner(this, 'MarbleUserContentSmokeTests', {
      sourceArtifact: appSourceArtifact,
      collectionPath: 'tests/postman/smoke.json',
      collectionVariables: {
        'api': testHostname,
      },
      actionName: 'SmokeTests',
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
    if(props.slackNotifyStackName !== undefined){
      const slackApproval = new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    // Deploy to Production
    const prodHostnamePrefix = props.hostnamePrefix
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, props.hostnamePrefix, props.prodFoundationStack)
    const prodHostname = `https://${prodHostnamePrefix}.` + props.prodFoundationStack.hostedZone.zoneName
    const addProdDataAction = new codepipelineActions.CodeBuildAction({
      input: appSourceArtifact,
      project: addDataProject,
      actionName: 'AddData',
      runOrder: 97,
      environmentVariables: {
        ITEMS_TABLE: {
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
          value: `/all/stacks/${prodStackName}/items-tablename`,
        },
        COLLECTIONS_TABLE: {
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
          value: `/all/stacks/${prodStackName}/collections-tablename`,
        },
        USERS_TABLE: {
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
          value: `/all/stacks/${prodStackName}/users-tablename`,
        },
      },
    })
    const smokeTestsProd = new NewmanRunner(this, 'MarbleUserContentProdSmokeTests', {
      sourceArtifact: appSourceArtifact,
      collectionPath: 'tests/postman/smoke.json',
      collectionVariables: {
        'api': prodHostname,
      },
      actionName: 'SmokeTests',
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
          actions: [deployTest.action, addTestDataAction, smokeTestsProject.action, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action, addProdDataAction, smokeTestsProd.action],
          stageName: 'Production',
        },
      ],
    })
    if(props.notificationReceivers){
      const notifications = new PipelineNotifications(this, 'PipelineNotifications', {
        pipeline,
        receivers: props.notificationReceivers,
      })
    }
  }
}