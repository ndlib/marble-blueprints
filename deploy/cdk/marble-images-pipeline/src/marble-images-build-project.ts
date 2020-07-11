import codebuild = require('@aws-cdk/aws-codebuild')
import { Role } from '@aws-cdk/aws-iam'
import cdk = require('@aws-cdk/core')

export interface IMarbleImagesBuildProjectProps extends codebuild.PipelineProjectProps {
  readonly stage: string
  readonly role: Role
  readonly contact: string
  readonly owner: string
  readonly gitOwner: string
  readonly marbleImagesRepository: string
}

export class MarbleImagesBuildProject extends codebuild.PipelineProject {
  constructor(scope: cdk.Construct, id: string, props: IMarbleImagesBuildProjectProps) {
    const serviceStackPrefix = scope.node.tryGetContext('serviceStackName') || 'marbleImages'
    const pipelineProps = {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
        environmentVariables: {
          STACK_NAME: {
            value: `${serviceStackPrefix}-${props.stage}`,
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          },
          CI: {
            value: 'true',
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          },
          STAGE: {
            value: props.stage,
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          },
          CONTACT: {
            value: props.contact,
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          },
          OWNER: {
            value: props.owner,
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          },
          GITHUB_REPO: {
            value: `${props.gitOwner}/${props.marbleImagesRepository}`,
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          },
        },
      },
      role: props.role,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '12.x',
            },
            commands: [
              'echo "Ensure that the codebuild directory is executable"',
              'chmod -R 755 ./scripts/codebuild/*',
              'MARBLE_HOME="$CODEBUILD_SRC_DIR_InfraCode"',
              'export BLUEPRINTS_DIR="${MARBLE_HOME}/deploy/cdk/marble-images-pipeline"',
              './scripts/codebuild/install.sh',
            ],
          },
          pre_build: {
            commands: ['./scripts/codebuild/pre_build.sh'],
          },
          build: {
            commands: ['./scripts/codebuild/build.sh'],
          },
          post_build: {
            commands: ['./scripts/codebuild/post_build.sh'],
          },
        },
      }),
    }
    super(scope, id, pipelineProps)
  }
}

export default MarbleImagesBuildProject
