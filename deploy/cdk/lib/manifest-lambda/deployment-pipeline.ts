import codepipeline = require('aws-cdk-lib/aws-codepipeline')
import codepipelineActions = require('aws-cdk-lib/aws-codepipeline-actions')
import { BuildSpec, LinuxBuildImage, PipelineProject, BuildEnvironmentVariableType } from 'aws-cdk-lib/aws-codebuild'
import { CodeBuildAction, GitHubTrigger } from 'aws-cdk-lib/aws-codepipeline-actions'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { SecretValue, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NewmanRunner, SlackApproval, PipelineNotifications } from '@ndlib/ndlib-cdk2'
import { CDKPipelineDeploy } from '../cdk-pipeline-deploy'
import { NamespacedPolicy } from '../namespaced-policy'
import { FoundationStack, PipelineFoundationStack } from '../foundation'
import { GithubApproval } from '../github-approval'

export interface IDeploymentPipelineStackProps extends StackProps {
  readonly pipelineFoundationStack: PipelineFoundationStack;
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
  readonly hostnamePrefix: string;
  readonly createDns: boolean;
  readonly sentryDsn: string;
  readonly slackNotifyStackName?: string;
  readonly notificationReceivers?: string;
  readonly createGithubWebhooks: boolean;
  readonly publicGraphqlHostnamePrefix: string;
  readonly testFoundationStack: FoundationStack
  readonly prodFoundationStack: FoundationStack
  readonly dockerhubCredentialsPath: string;
  readonly domainName: string
 }


export class DeploymentPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: IDeploymentPipelineStackProps) {
    super(scope, id, props)

    const testStackName = `${props.namespace}-test-manifest-lambda`
    const prodStackName = `${props.namespace}-prod-manifest-lambda`

    // Helper for creating a Pipeline project and action with deployment permissions needed by this pipeline
    const createDeploy = (targetStack: string, namespace: string, hostnamePrefix: string, deployConstructName: string, publicGraphqlHostnamePrefix: string) => {
      const cdkDeploy = new CDKPipelineDeploy(this, deployConstructName, {
        targetStack,
        dependsOnStacks: [],
        infraSourceArtifact,
        appSourceArtifact,
        appBuildCommands: [
          'echo "Ensure that the codebuild directory is executable"',
          'ls',
          'chmod -R 755 ./scripts/codebuild/*',
          `export BLUEPRINTS_DIR="$CODEBUILD_SRC_DIR_${infraSourceArtifact.artifactName}"`,
          './scripts/codebuild/install.sh',
          'pyenv version || { echo "Python version mismatch"; exit 1; }',
          'yarn',
        ],
        outputFiles: [
          `**/*`,
        ],
        cdkDirectory: 'deploy/cdk',
        namespace: `${namespace}`,
        contextEnvName: props.contextEnvName,
        dockerhubCredentialsPath: props.dockerhubCredentialsPath,
        additionalContext: {
          description: "data pipeline for creating manifest lambda",
          projectName: "marble",
          owner: props.owner,
          contact: props.contact,
          "manifestLambda:hostnamePrefix": hostnamePrefix,
          "manifestLambda:lambdaCodeRootPath": `$CODEBUILD_SRC_DIR_${appSourceArtifact.artifactName}`,
          "manifestLambda:publicGraphqlHostnamePrefix": publicGraphqlHostnamePrefix,
        },
      })
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.api())
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.iamRole(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.events(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.logstream(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.ssm(targetStack))
      cdkDeploy.project.addToRolePolicy(NamespacedPolicy.lambda(targetStack))
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

      if (props.createDns) {
        cdkDeploy.project.addToRolePolicy(NamespacedPolicy.route53RecordSet('*'))
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


    const appUnitTestsProject = new PipelineProject(this, 'AppUnitTests', {
      environment: {
        buildImage: LinuxBuildImage.STANDARD_4_0,
      },
      environmentVariables: {
        /* macos and other versions(ex: aws ubuntu codebuild) of pyenv dont ALWAYS
        allow for the same patch version of python to be installed. If they differ
        then use this env var override .python-version files */
        PYENV_VERSION: {
          value: `3.8.10`,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
      },
      buildSpec: BuildSpec.fromObject({
        phases: {
          install: {
            'runtime-versions': {
              python: '3.8',
            },
            commands: [
              'pyenv version || { echo "Python version mismatch"; exit 1; }',
              'pip install -r dev-requirements.txt',
              'chmod -R 755 ./scripts/codebuild/*',
              './scripts/codebuild/install.sh',
            ],
          },
          build: {
            commands: [
              // pre_build is the script for UT for this app
              './scripts/codebuild/pre_build.sh',
            ],
          },
        },
        version: '0.2',
      }),
    })
    const appUnitTestsAction = new CodeBuildAction({
      actionName: 'Application',
      input: appSourceArtifact,
      project: appUnitTestsProject,
      runOrder: 1,
    })

    // Deploy to Test
    const testHostnamePrefix = `${props.hostnamePrefix}-test`
    const testPublicGraphqlHostnamePrefix = `${props.namespace}-test-${props.publicGraphqlHostnamePrefix}`
    const deployTest = createDeploy(testStackName, `${props.namespace}-test`, testHostnamePrefix, `${props.namespace}-manifest-lambda-deploy-test`, testPublicGraphqlHostnamePrefix)
    const testHostname = `${testPublicGraphqlHostnamePrefix}.${props.domainName}`

    const newmanRunnerTest = new NewmanRunner(this, 'NewmanRunnerTest', {
      sourceArtifact: infraSourceArtifact,
      collectionPath: 'deploy/cdk/test/manifest-lambda/smokeTests.json',
      collectionVariables: {
        hostname: testHostname,
      },
      actionName: 'SmokeTests',
    })

    // Approval
    const approvalTopic = new Topic(this, 'ApprovalTopic')
    const approvalAction = new GithubApproval({
      notificationTopic: approvalTopic,
      testTarget: `stack ${testStackName}`,
      prodTarget: `stack ${prodStackName}`,
      githubSources: [
        { owner: props.appRepoOwner, sourceAction: appSourceAction },
        { owner: props.infraRepoOwner, sourceAction: infraSourceAction },
      ],
    })
    if(props.slackNotifyStackName !== undefined){
      new SlackApproval(this, 'SlackApproval', {
        approvalTopic,
        notifyStackName: props.slackNotifyStackName,
      })
    }

    // Deploy to Production
    const prodPublicGraphqlHostnamePrefix = `${props.namespace}-prod-${props.publicGraphqlHostnamePrefix}`
    const deployProd = createDeploy(prodStackName, `${props.namespace}-prod`, props.hostnamePrefix, `${props.namespace}-manifest-lambda-deploy-prod`, prodPublicGraphqlHostnamePrefix)
    const prodHostname = `${prodPublicGraphqlHostnamePrefix}.${props.domainName}`
    const newmanRunnerProd = new NewmanRunner(this, 'NewmanRunnerProd', {
      sourceArtifact: infraSourceArtifact,
      collectionPath: 'deploy/cdk/test/manifest-lambda/smokeTests.json',
      collectionVariables: {
        hostname: prodHostname,
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
          actions: [appUnitTestsAction],
          stageName: 'UnitTest',
        },
        {
          actions: [deployTest.action, newmanRunnerTest.action, approvalAction],
          stageName: 'Test',
        },
        {
          actions: [deployProd.action, newmanRunnerProd.action],
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
