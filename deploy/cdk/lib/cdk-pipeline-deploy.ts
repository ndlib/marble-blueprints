import { BuildEnvironmentVariableType, BuildSpec, LinuxBuildImage, PipelineProject, PipelineProjectProps } from 'aws-cdk-lib/aws-codebuild'
import { Artifact } from 'aws-cdk-lib/aws-codepipeline'
import { CodeBuildAction } from 'aws-cdk-lib/aws-codepipeline-actions'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Fn } from 'aws-cdk-lib'
import { Construct } from "constructs"

export interface ICDKPipelineDeployProps extends PipelineProjectProps {
  /**
   * The name of the stack that this project will deploy to. Will add
   * permissions to create change sets on these stacks.
   */
  readonly targetStack: string
  /**
   * The stack names that the target stack will depend on. Will add permissions
   * to also create change sets on these stacks. Note: This can be ignored
   * if using the cdk deploy --exclusively option.
   */
  readonly dependsOnStacks: string[]

  /**
   * Infrastructure source artifact. Must include the cdk code
   */
  readonly infraSourceArtifact: Artifact

  /**
   * Application source artifact.
   */
  readonly appSourceArtifact?: Artifact

  /**
   * Subdirectory of the infrastructure source where the cdk code can be found, without leading /
   * The action created will use infra source as primary input, so this should be a subdir of the
   * CODEBUILD_SRC_DIR environment variable
   */
  readonly cdkDirectory?: string

  /**
   * Namespace to use for stack names etc
   */
  readonly namespace: string

  /**
   * Any additional key value pairs to pass as additional --context overrides when deploying
   */
  readonly additionalContext?: { [key: string]: string }

  readonly contextEnvName: string
  readonly appBuildCommands?: string[]
  readonly postDeployCommands?: string[]
  readonly outputDirectory?: string
  readonly outputFiles?: string[]
  readonly outputArtifact?: Artifact
  readonly dockerhubCredentialsPath: string
  /**
   * Any runtime environments needed in addition to the one needed for cdk itself (currently nodejs: '16.x')  e.g. `python: '3.9'`
   */
  readonly additionalRuntimeEnvironments?: { [key: string]: string }
  readonly stage: string
}

/**
 * Convenience class for creating a PipelineProject and Action that will use cdk to deploy
 * the service stacks in this application. Primarily handles adding the necessary
 * permissions for cdk to make changes to the target stacks involved.
 */
export class CDKPipelineDeploy extends Construct {
  public readonly project: PipelineProject
  public readonly action: CodeBuildAction

  constructor(scope: Construct, id: string, props: ICDKPipelineDeployProps) {
    super(scope, id)

    let addtlContext = ''
    if(props.additionalContext !== undefined){
      Object.entries(props.additionalContext).forEach((val) => {
        addtlContext += ` -c "${val[0]}=${val[1]}"`
      })
    }
    let appSourceDir = "$CODEBUILD_SRC_DIR"
    const extraInputs: Array<Artifact> = []
    if (props.appSourceArtifact !== undefined) {
      extraInputs.push(props.appSourceArtifact)
      appSourceDir = `$CODEBUILD_SRC_DIR_${props.appSourceArtifact.artifactName}`
    }
    this.project = new PipelineProject(scope, `${id}Project`, {
      environment: {
        buildImage: LinuxBuildImage.STANDARD_5_0,
        privileged: true,
      },
      buildSpec: BuildSpec.fromObject({
        artifacts: {
          'base-directory': props.outputDirectory,
          files: props.outputFiles || [],
        },
        phases: {
          install: {
            commands: [
              // 'n stable',
              'n 16',
              `cd $CODEBUILD_SRC_DIR/${props.cdkDirectory || ''}`,
              'yarn install',
            ],
            'runtime-versions': {
              // nodejs: '16.x',
              ...(props.additionalRuntimeEnvironments || []),
            },
          },
          pre_build: {
            commands: [
              `cd ${appSourceDir}`,
              'echo $DOCKERHUB_PASSWORD | docker login --username $DOCKERHUB_USERNAME --password-stdin',
              ...(props.appBuildCommands || []),
            ],
          },
          build: {
            commands: [
              `cd $CODEBUILD_SRC_DIR/${props.cdkDirectory || ''}`,
              `npm run cdk deploy -- ${props.targetStack} \
                --require-approval never --exclusively \
                -c "namespace=${props.namespace}" \
                -c "stage=${props.stage}" \
                -c "env=${props.contextEnvName}" ${addtlContext}`,
            ],
          },
          post_build: {
            commands: props.postDeployCommands || [],
          },
        },
        version: '0.2',
      }),
      ...props,
    })

    // CDK will try to read logs when generating output for failed events
    this.project.addToRolePolicy(new PolicyStatement({
      actions: [ 'logs:DescribeLogGroups'],
      resources: [ '*' ],
    }))

    // Anytime cdk deploys a stack without --exclusively, it will try to also update the stacks it depends on.
    // So, we need to give the pipeline permissions to update the target stack and the stacks it depends on.
    this.project.addToRolePolicy(new PolicyStatement({
      actions: [
        'cloudformation:CreateChangeSet',
        'cloudformation:DeleteStack',
        'cloudformation:DeleteChangeSet',
        'cloudformation:DescribeChangeSet',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:ExecuteChangeSet',
        'cloudformation:GetTemplate',
      ],
      resources: [props.targetStack, ...props.dependsOnStacks].map(s => Fn.sub('arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/' + s + '/*')),
    }))

    // Add permissions to read CDK bootstrap stack/bucket
    this.project.addToRolePolicy(new PolicyStatement({
      actions: ['cloudformation:DescribeStacks'],
      resources: [ Fn.sub('arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/CDKToolkit/*') ],
    }))
    this.project.addToRolePolicy(new PolicyStatement({
      // TODO: Is there a way to get the bucket name?
      actions: [
        's3:ListBucket',
        's3:GetObject',
        's3:PutObject',
        's3:ListBucketVersions',
        's3:GetBucketLocation',
        's3:GetBucketPolicy',
      ],
      resources: [ 'arn:aws:s3:::cdk*' ],
    }))

    // Add permission for CDK 2 deployments
    this.project.addToRolePolicy(new PolicyStatement({
      actions: [
        'sts:AssumeRole',
        'iam:PassRole',
      ],
      resources: [
        'arn:aws:iam::*:role/cdk-readOnlyRole',
        'arn:aws:iam::*:role/cdk-hnb659fds-deploy-role-*',
        'arn:aws:iam::*:role/cdk-hnb659fds-file-publishing-*',
        'arn:aws:iam::*:role/cdk-hnb659fds-image-publishing-*',
      ],
    }))
    // Allow getting bootstrap SSM parameter
    this.project.addToRolePolicy(new PolicyStatement({
      resources: [
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/cdk-bootstrap/*'),
      ],
      actions: [
        'ssm:GetParameter',
      ],
    }))
    
    // Allow fetching DNS parameters from ssm
    this.project.addToRolePolicy(
      new PolicyStatement({
        resources: [
          Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/all/dns/*'),
        ],
        actions: ['ssm:GetParametersByPath', 'ssm:GetParameter', 'ssm:GetParameters'],
      }),
    )

    this.action = new CodeBuildAction({
      actionName: 'DeployInfastructure',
      input: props.infraSourceArtifact,
      extraInputs: extraInputs,
      project: this.project,
      runOrder: 1,
      outputs: (props.outputArtifact ? [props.outputArtifact] : []),
      environmentVariables: {
        DOCKERHUB_CREDENTIALS_PATH: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: props.dockerhubCredentialsPath || '',
        },
        DOCKERHUB_USERNAME: {
          type: BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: `${props.dockerhubCredentialsPath}:username`,
        },
        DOCKERHUB_PASSWORD: {
          type: BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: `${props.dockerhubCredentialsPath}:password`,
        },
      },
})
  }
}
