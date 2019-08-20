import cdk = require('@aws-cdk/core')
import codebuild = require('@aws-cdk/aws-codebuild')
import { BuildEnvironmentVariableType } from '@aws-cdk/aws-codebuild'
import { Role } from '@aws-cdk/aws-iam'

export enum BuildProjectType {
  BUILD,
  DEPLOY,
}

export interface BuildProjectProps {
  projectType: BuildProjectType,
  role: Role,
  stage: String,
  context?: { [key: string]: any },
}

const getContextCliArguments = (props: BuildProjectProps) => {
  let output = ''
  // if context is undefined, create an empty object so it doesn't crash
  const context: { [key: string]: any } = props.context || {}
  for (const key in context) {
    if (key) {
      output += `-c ${key}="${context[key]}"`
    }
  }
  return output
}

const getPhases = (props: BuildProjectProps) => {
  switch (props.projectType) {
    case BuildProjectType.BUILD:
      return {
        install: {
          'runtime-versions': {
            nodejs: 10,
            python: 3.7,
          },
          commands: [
            'echo "Ensure that the codebuild directory is executable"',
            'chmod -R 755 ./scripts/codebuild/*',
            './scripts/codebuild/install.sh',
            'chmod -R 755 ./local_install.sh',
            './local_install.sh',
          ],
        },
        pre_build: {
          commands: [`./scripts/codebuild/pre_build.sh`],
        },
        build: {
          commands: [`./scripts/codebuild/build.sh ${getContextCliArguments(props)}`],
        },
        post_build: {
          commands: ['./scripts/codebuild/post_build.sh'],
        },
      }
    case BuildProjectType.DEPLOY:
      return {
        install: {
          'runtime-versions': {
            nodejs: 10,
            python: 3.7,
          },
          commands: [
            'echo "Ensure that the codebuild directory is executable"',
            'chmod -R 755 ./scripts/codebuild/*',
            './scripts/codebuild/install.sh',
          ],
        },
        build: {
          commands: [`./scripts/codebuild/deploy.sh ${getContextCliArguments(props)} --verbose`],
        },
      }
  }
}

export const BuildProject = (scope: cdk.Construct, props: BuildProjectProps) => {
  return new codebuild.PipelineProject(scope, `${props.stage}${Object.values(BuildProjectType)[props.projectType]}Project`, {
    environment: {
      buildImage: codebuild.LinuxBuildImage.STANDARD_2_0,
    },
    environmentVariables: {
      'CI': { value: 'true', type: BuildEnvironmentVariableType.PLAINTEXT },
      'STAGE': { value: props.stage, type: BuildEnvironmentVariableType.PLAINTEXT },
    },
    role: props.role,
    buildSpec: codebuild.BuildSpec.fromObject({
      version: '0.2',
      phases: getPhases(props),
      artifacts: {
        'files': [
          'dist/**/*',
          'scripts/codebuild/**/*'
        ],
      },
    }),
  })
}
