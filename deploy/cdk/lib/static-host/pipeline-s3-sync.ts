import { BuildSpec, LinuxBuildImage, PipelineProject, PipelineProjectProps, BuildEnvironmentVariableType } from '@aws-cdk/aws-codebuild'
import { Artifact } from '@aws-cdk/aws-codepipeline'
import { CodeBuildAction } from '@aws-cdk/aws-codepipeline-actions'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Construct, Fn, Duration } from '@aws-cdk/core'
import { NamespacedPolicy } from '../namespaced-policy'
import { ElasticStack } from '../elasticsearch'

export interface IPipelineS3SyncProps extends PipelineProjectProps {  /**
   * The name of the stack that this project will deploy to. Will add
   * permissions to create change sets on these stacks.
   */
  readonly targetStack: string

  /**
   * Artifact that contains the build which needs to be synced to the s3 bucket.
   * Presumably the output from a previous codebuild project.
   */
  readonly inputBuildArtifact: Artifact;

  readonly artifactPath: string

  /**
   * Subdirectory of files to sync. Optional; will sync everything by default.
   */
  readonly subdirectory?: string

  readonly searchIndex?: string
  readonly esEndpointParamPath?: string
  readonly elasticSearchDomainName?: string
}

export class PipelineS3Sync extends Construct {
  public readonly project: PipelineProject
  public readonly action: CodeBuildAction

  constructor(scope: Construct, id: string, props: IPipelineS3SyncProps) {
    super(scope, id)
    const paramsPath = `/all/static-host/${props.targetStack}/`

    this.project = new PipelineProject(scope, `${props.targetStack}-S3Sync`, {
      description: 'Deploys built source web component to bucket',
      timeout: Duration.minutes(10),
      environment: {
        buildImage: LinuxBuildImage.STANDARD_4_0,
        privileged: true,
      },
      environmentVariables: {
        S3_DEST_BUCKET: {
          value: `${paramsPath}/site-bucket-name`,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        DISTRIBUTION_ID: {
          value: `${paramsPath}/distribution-id`,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        SEARCH_URL: {
          value: props.esEndpointParamPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        SEARCH_INDEX: {
            value: props.searchIndex,
            type: BuildEnvironmentVariableType.PLAINTEXT,
        },
      },
      buildSpec: BuildSpec.fromObject({
        phases: {
          install: {
            commands: [
              `chmod -R 755 ./scripts`,
              `export BLUEPRINTS_DIR="$CODEBUILD_SRC_DIR"`,
              `export PARAM_CONFIG_PATH="${paramsPath}"`,
              `./scripts/codebuild/install.sh`,
            ]
          },
          pre_build: {
            commands: [
              `./scripts/codebuild/pre_build.sh`,
            ],
          },
          build: {
            commands: [
              `./scripts/codebuild/build.sh`,
            ],
          },
          post_build: {
            commands: [
              `./scripts/codebuild/post_build.sh`,
              `aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"`,
            ],
          },
        },
        version: '0.2',
      }),
    })

    // CDK will try to read logs when generating output for failed events
    this.project.addToRolePolicy(new PolicyStatement({
      actions: [ 'logs:DescribeLogGroups'],
      resources: [ '*' ],
    }))

    // Add permissions to read CDK bootstrap stack/bucket
    this.project.addToRolePolicy(new PolicyStatement({
      actions: ['cloudformation:DescribeStacks'],
      resources: [ Fn.sub('arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/CDKToolkit/*') ],
    }))
    this.project.addToRolePolicy(new PolicyStatement({
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
      ],
      resources:[
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + paramsPath + '*'),
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.esEndpointParamPath),
      ],
    }))
    this.project.addToRolePolicy(new PolicyStatement({
      actions: [
        's3:ListBucket',
        's3:GetObject',
        's3:PutObject',
        's3:ListBucketVersions',
        's3:GetBucketLocation',
        's3:GetBucketPolicy',
      ],
      resources: [ 'arn:aws:s3:::cdktoolkit-stagingbucket-*' ],
    }))
    this.project.addToRolePolicy(new PolicyStatement({
      actions: [
        'cloudfront:CreateInvalidation',
      ],
      resources: ['*'],
    }))
    // We don't know exactly what the bucket's name will be until runtime, but it starts with the stack's name
    this.project.addToRolePolicy(NamespacedPolicy.s3(props.targetStack))
    this.project.addToRolePolicy(NamespacedPolicy.ssm(props.targetStack))
    if (props.elasticSearchDomainName !== undefined) {
      this.project.addToRolePolicy(NamespacedPolicy.elasticsearchInvoke(props.elasticSearchDomainName))
    }

    this.action = new CodeBuildAction({
      actionName: 'BuildSite_and_CopyS3',
      input: props.inputBuildArtifact,
      project: this.project,
      runOrder: 2,
    })
  }
}
