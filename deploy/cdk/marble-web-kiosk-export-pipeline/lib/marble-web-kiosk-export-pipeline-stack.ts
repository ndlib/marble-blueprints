import cdk = require('@aws-cdk/core');
import { SecretValue, Fn, RemovalPolicy, CfnParameter } from '@aws-cdk/core'
import codepipeline = require('@aws-cdk/aws-codepipeline')
import codepipelineActions = require('@aws-cdk/aws-codepipeline-actions')
import sns = require('@aws-cdk/aws-sns')
import { Role, ServicePrincipal, PolicyStatement, Effect, AnyPrincipal } from '@aws-cdk/aws-iam'
import { Bucket } from '@aws-cdk/aws-s3'
import readlineSync = require('readline-sync')
import { BuildProject, BuildProjectType } from './build-project'

export class MarbleWebKioskExportStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // I copied this from lambda-purl-blueprints then modified it to fit my needs

        // SETUP RESOURCES AND PERMISSIONS NEEDED FOR PIPELINE
        const {
          repoName, repoOwner, repoBranch,
          artifactBucket, approvalTopic,
          codepipeline_role, codebuild_role
        } = this.setup()

        // CREATE PIPELINE
        const pipeline = new codepipeline.Pipeline(this, 'MarbleWebKioskExportPipeline', {
          artifactBucket: artifactBucket,
          role: codepipeline_role,
        })

        // SOURCE REPOSITORY
        // Need a cloudformation parameter to keep the token from being exposed in the template
        const oAuthTokenParam = new CfnParameter(this, 'GitHubToken', {
          type: 'String',
          noEcho: true,
          minLength: 8, // Token length could change over time, but at least make sure it is something sane so the user doesn't leave this blank
          description: 'Secret. OAuthToken with access to Repo. Long string of characters and digits. Go to https://github.com/settings/tokens',
        })
        const sourceOutput = new codepipeline.Artifact()
        const sourceAction = new codepipelineActions.GitHubSourceAction({
            actionName: 'Github_App_Source',
            owner: repoOwner,
            repo: repoName,
            branch: repoBranch,
            oauthToken: SecretValue.cfnParameter(oAuthTokenParam),
            output: sourceOutput,
            trigger: codepipelineActions.GitHubTrigger.POLL,
        })
        pipeline.addStage({
          stageName: 'Source',
          actions: [ sourceAction ],
        })

        // BUILD STACKS
        const stages = ['test', 'prod']
        const buildActions: codepipelineActions.CodeBuildAction[] = []
        const buildOutput: {
          [stage: string]: codepipeline.Artifact,
        } = {}

        stages.forEach(stage => {
          buildOutput[stage] = new codepipeline.Artifact()
          const localBuildProject = BuildProject(this, {
            projectType: BuildProjectType.BUILD,
            role: codebuild_role,
            stage: stage,
          })
          buildActions.push(new codepipelineActions.CodeBuildAction({
            actionName: `${stage}BuildMarbleWebKioskExportStack`,
            project: localBuildProject,
            input: sourceOutput,
            outputs: [ buildOutput[stage] ],
          }))
        })

        pipeline.addStage({
          stageName: 'Build',
          actions: [ ...buildActions ], // We need to spread the array because we build both test and prod here
        })

        // DEPLOY TO TEST
        const deployToTestProject = BuildProject(this, {
          projectType: BuildProjectType.DEPLOY,
          role: codebuild_role,
          stage: 'test',
        })
        const deployToTestAction = new codepipelineActions.CodeBuildAction({
          actionName: 'Deploy',
          project: deployToTestProject,
          input: buildOutput['test'],
          runOrder: 1,
        })

        const manualApprovalAction = new codepipelineActions.ManualApprovalAction({
          actionName: 'ManualApprovalOfTestEnvironment',
          notificationTopic: approvalTopic,
          additionalInformation: 'Approve or Reject this change after testing',
          runOrder: 2,
        })

        pipeline.addStage({
          stageName: 'DeployToTest',
          actions: [ deployToTestAction, manualApprovalAction ],
        })

        // DEPLOY TO PROD
        const deployToProdProject = BuildProject(this, {
          projectType: BuildProjectType.DEPLOY,
          role: codebuild_role,
          stage: 'prod',
        })
        const deployToProdAction = new codepipelineActions.CodeBuildAction({
          actionName: 'Deploy',
          project: deployToProdProject,
          input: buildOutput['prod'],
        })

        pipeline.addStage({
          stageName: 'DeployToProd',
          actions: [ deployToProdAction ],
        })
      }

      setup () {
        // This must match the stack name of the marble-web-kiosk-export project without the stage suffix.
        // This is also the same as the GitHub repository name.
        const localStackName = 'marble-web-kiosk-export'

        const repoName = this.node.tryGetContext('repoName') ||
          readlineSync.question('What is the name of the GitHub repository that has the application source code? (default: ' + localStackName + ') ', {
            defaultInput: localStackName,
          })
        const repoOwner = this.node.tryGetContext('repoOwner') ||
          readlineSync.question('What is the owner name for the GitHub repository specified? (default: ndlib) ', {
            defaultInput: 'ndlib',
          })
        const repoBranch = this.node.tryGetContext('repoBranch') ||
          readlineSync.question('Which branch do you want to build from? (default: master) ', {
            defaultInput: 'master',
          })

        // S3 BUCKET FOR STORING ARTIFACTS
        const artifactBucket = new Bucket(this, 'ArtifactBucket', {
          removalPolicy: RemovalPolicy.DESTROY,
        })
        artifactBucket.addToResourcePolicy(new PolicyStatement({
          principals: [new AnyPrincipal()],
          effect: Effect.DENY,
          actions: ['s3:*'],
          conditions: {
            'Bool': { 'aws:SecureTransport': false }
          },
          resources: [artifactBucket.bucketArn + '/*']
        }))

        // SNS TOPICS
        const approvalTopic = new sns.Topic(this, 'PipelineApprovalTopic', {
          displayName: 'PipelineApprovalTopic',
        })

        // IAM ROLES
        const codepipeline_role = new Role(this, 'CodePipelineRole', {
          assumedBy: new ServicePrincipal('codepipeline.amazonaws.com')
        })

        const codebuild_role = new Role(this, 'CodeBuildTrustRole', {
          assumedBy: new ServicePrincipal('codebuild.amazonaws.com')})
          // Allow checking what policies are attached to this role and any roles the application stack creates
          // When cdk makes roles, it removes all punctuation. The application stack should prefix the LogicalId
          // of any construct that needs roles with the stack name so that it matches the wildcard here.
          const rolePattern = localStackName.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") + '*'
          codebuild_role.addToPolicy(new PolicyStatement({
            resources: [
              codebuild_role.roleArn,
              Fn.sub('arn:aws:iam::${AWS::AccountId}:role/' + rolePattern),
            ],
            actions: ['iam:GetRolePolicy'],
          }))

        // Allow access to Parameter Store
        codebuild_role.addToPolicy(new PolicyStatement({
            resources:[Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/all/marble-data-processing/*')],
            actions: ["ssm:GetParameterHistory",
                "ssm:GetParametersByPath",
                "ssm:GetParameters",
                "ssm:GetParameter",
            ],
        }))
        // Allow testing to send email
        codebuild_role.addToPolicy(new PolicyStatement({
          resources: [ Fn.sub('arn:aws:ses:${AWS::Region}:${AWS::AccountId}:identity/nd.edu') ],
          actions: ['ses:SendEmail'],
        }))

        // Allow DescribeRule
        codebuild_role.addToPolicy(new PolicyStatement({
          resources: [ Fn.sub('arn:aws:events:${AWS::Region}:${AWS::AccountId}:rule/' + localStackName + '-*') ],
          actions: ['events:DescribeRule', 'events:PutRule', 'events:PutTargets'],
        }))

        // Allow logging
        codebuild_role.addToPolicy(new PolicyStatement({
          resources: [ Fn.sub('arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/codebuild/${AWS::StackName}-*') ],
          actions: ['logs:CreateLogGroup','logs:CreateLogStream','logs:PutLogEvents'],
        }))
        // Allow storing artifacts in S3 buckets
        // Allow staging of assets in the cdk staging bucket - necessary when the application has lambda code.
        codebuild_role.addToPolicy(new PolicyStatement({
          resources: [
            artifactBucket.bucketArn,
            'arn:aws:s3:::cdktoolkit-stagingbucket-*',
          ],
          actions: [
            's3:ListBucket',
            's3:GetObject',
            's3:PutObject',
          ],
        }))
        // Allow fetching details about and updating the application stack
        codebuild_role.addToPolicy(new PolicyStatement({
          resources: [ Fn.sub('arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/' + localStackName + '-*/*') ],
          actions: [
            'cloudformation:DescribeStacks',
            'cloudformation:DescribeStackEvents',
            'cloudformation:DescribeChangeSet',
            'cloudformation:CreateChangeSet',
            'cloudformation:ExecuteChangeSet',
            'cloudformation:DeleteChangeSet',
            'cloudformation:DeleteStack',
            'cloudformation:GetTemplate',
          ],
        }))
        // Allow reading some details about CDKToolkit stack so we can use the CDK CLI successfully from CodeBuild.
        codebuild_role.addToPolicy(new PolicyStatement({
          resources: [ Fn.sub('arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/CDKToolkit/*') ],
          actions: ['cloudformation:DescribeStacks'],
        }))
        // Allow modifying IAM roles related to our application
        codebuild_role.addToPolicy(new PolicyStatement({
          resources: [ Fn.sub('arn:aws:iam::${AWS::AccountId}:role/' + localStackName + '-*') ],
          actions: ['iam:GetRole','iam:CreateRole','iam:DeleteRole','iam:DeleteRolePolicy','iam:AttachRolePolicy','iam:DetachRolePolicy','iam:PutRolePolicy','iam:PassRole'],
        }))
        // Allow full control over lambdas related to our application
        codebuild_role.addToPolicy(new PolicyStatement({
          resources: [ Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:' + localStackName + '*') ],
          actions: ['lambda:*'],
        }))

        return {
          repoName,
          repoOwner,
          repoBranch,
          artifactBucket,
          approvalTopic,
          codepipeline_role,
          codebuild_role,
        }
    // pasted to here
  }
}
