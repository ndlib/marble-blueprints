import { BuildSpec, LinuxBuildImage, PipelineProject, PipelineProjectProps, BuildEnvironmentVariableType } from '@aws-cdk/aws-codebuild'
import { Artifact } from '@aws-cdk/aws-codepipeline'
import { CodeBuildAction } from '@aws-cdk/aws-codepipeline-actions'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Construct, Fn, Duration } from '@aws-cdk/core'
import { NamespacedPolicy } from '../namespaced-policy'

export interface IPipelineS3SyncProps extends PipelineProjectProps {  /**
   * The name of the stack that this project will deploy to. Will add
   * permissions to create change sets on these stacks.
   */
  readonly targetStack: string

  /**
   * Artifact that contains the files which need to be built by the code.
   * Presumably the output from a github pull
   */
  readonly inputBuildArtifact: Artifact;

  /**
   * Additional Artifacts that contain the files which need to be built by the code.
   * Presumably the output from a github pull
   */
  extraBuildArtifacts?: Array<Artifact>;

  /**
  * The name of the index that should be created for the website in elasticsearch
  */
  readonly searchIndex: string

  /**
  * the ssm path to the full elasticsearch domain that we want a search index on\
  * example: https://search-jon-test-sites-xnwpt33aguihqeotpz7yp6zp5m.us-east-1.es.amazonaws.com
  */
  readonly esEndpointParamPath: string

  /**
  * the domain name part that is used for permissions to the elastic search domain.
  * example: jon-test-sites
  */
  readonly elasticSearchDomainName: string

  readonly siteDirectory: string
  readonly workspaceName: string
  readonly graphqlApiUrl: string
  readonly graphqlApiKey: string
}

export class PipelineS3Sync extends Construct {
  public readonly project: PipelineProject
  public readonly action: CodeBuildAction

  constructor(scope: Construct, id: string, props: IPipelineS3SyncProps) {
    super(scope, id)
    const paramsPath = `/all/stacks/${props.targetStack}/`
    const staticHostPath = `/all/static-host/${props.targetStack}/`
    const subModName = props.extraBuildArtifacts?.find(x=>x!==undefined)?.artifactName

    this.project = new PipelineProject(scope, `${props.targetStack}-S3Sync`, {
      description: 'Deploys built source web component to bucket',
      timeout: Duration.minutes(10),
      environment: {
        buildImage: LinuxBuildImage.STANDARD_4_0,
        privileged: true,
      },
      environmentVariables: {
        S3_DEST_BUCKET: {
          value: `${paramsPath}site-bucket-name`,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        DISTRIBUTION_ID: {
          value: `${paramsPath}distribution-id`,
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
        SITE_DIRECTORY: {
          value: props.siteDirectory,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        WORKSPACE_NAME: {
          value: props.workspaceName,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        TEST_GRAPHQL_API_URL: {
          value: props.graphqlApiUrl,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        TEST_GRAPHQL_API_KEY: {
          value: props.graphqlApiKey,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
      },
      buildSpec: BuildSpec.fromObject({
        phases: {
          build: {
            commands: [
                `chmod -R 755 ./scripts`,
                `export PARAM_CONFIG_PATH="${staticHostPath}"`,
                `export SUBMOD_DIR=$CODEBUILD_SRC_DIR_${subModName}`,
                `./scripts/codebuild/codebuild.sh`,
              ],
          },
          post_build: {
            commands: [
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
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + staticHostPath + '*'),
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
      extraInputs: props.extraBuildArtifacts,
      project: this.project,
      runOrder: 2,
    })
  }
}
