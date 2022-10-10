import { BuildSpec, LinuxBuildImage, PipelineProject, PipelineProjectProps, BuildEnvironmentVariableType, ComputeType } from 'aws-cdk-lib/aws-codebuild'
import { Artifact } from 'aws-cdk-lib/aws-codepipeline'
import { CodeBuildAction } from 'aws-cdk-lib/aws-codepipeline-actions'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Fn, Duration, SecretValue } from 'aws-cdk-lib'
import { Construct } from 'constructs'
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
  readonly inputBuildArtifact: Artifact

  /**
   * Additional Artifacts that contain the files which need to be built by the code.
   * Presumably the output from a github pull
   */
  extraBuildArtifacts?: Array<Artifact>

  /**
  * The name of the index that should be created for the website in OpenSearch
  */
  readonly searchIndex: string

  readonly siteDirectory: string
  readonly workspaceName: string
  readonly graphqlApiUrlKeyPath: string
  readonly graphqlApiKeyKeyPath: string
  readonly maintainMetadataKeyBase: string
  readonly buildEnvironment: string
  readonly publicGraphqlApiKeyPath: string
  readonly authClientUrl: string
  readonly authClientId: string
  readonly authClientIssuer: string
  readonly opensearchSecretsKeyPath: string
}

export class PipelineS3Sync extends Construct {
  public readonly project: PipelineProject
  public readonly action: CodeBuildAction

  constructor(scope: Construct, id: string, props: IPipelineS3SyncProps) {
    super(scope, id)
    const paramsPath = `/all/stacks/${props.targetStack}/`
    const staticHostPath = `/all/static-host/${props.targetStack}/`
    const subModName = props.extraBuildArtifacts?.find(x=>x!==undefined)?.artifactName


    const opensearchDomainName = SecretValue.secretsManager(props.opensearchSecretsKeyPath, { jsonField: 'opensearchDomainName' }).unsafeUnwrap()

    this.project = new PipelineProject(scope, `${props.targetStack}-S3Sync`, {
      description: 'Deploys built source web component to bucket',
      timeout: Duration.minutes(30),
      environment: {
        buildImage: LinuxBuildImage.STANDARD_5_0,
        privileged: true,
        computeType: ComputeType.LARGE,
      },
      environmentVariables: {
        BUILD_ENVIRONMENT: {
          value: props.buildEnvironment,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        S3_DEST_BUCKET: {
          value: `${paramsPath}site-bucket-name`,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        DISTRIBUTION_ID: {
          value: `${paramsPath}distribution-id`,
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
        GRAPHQL_API_URL: {
          value: props.graphqlApiUrlKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        // TODO: Remove at least GRAPHQL_API_KEY (maybe also GRAPHQL_API_URL) Once sites are updated to use GRAPHQL_API_KEY_KEY_PATH and GRAPHQL_API_URL_KEY_PATH
        // GRAPHQL_API_KEY and 
        GRAPHQL_API_KEY: {
          value: props.graphqlApiKeyKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        GRAPHQL_API_KEY_KEY_PATH: {
          value: props.graphqlApiKeyKeyPath,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        GRAPHQL_API_URL_KEY_PATH: {
          value: props.graphqlApiUrlKeyPath,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        GRAPHQL_KEY_BASE: {
          value: props.maintainMetadataKeyBase,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        PUBLIC_GRAPHQL_API_URL: {
          value: props.publicGraphqlApiKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },

        // Pass external (to marble) Opensearch Domain parameters found in Secrets Manager
        OPENSEARCH_DOMAIN_NAME: {
          value: opensearchDomainName,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        OPENSEARCH_ENDPOINT: {
          value: SecretValue.secretsManager(props.opensearchSecretsKeyPath, { jsonField: 'opensearchEndpoint' }).unsafeUnwrap(),
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        OPENSEARCH_MASTER_USERNAME: {
          value: `${props.opensearchSecretsKeyPath}:masterUserName`,
          type: BuildEnvironmentVariableType.SECRETS_MANAGER,
        },
        OPENSEARCH_MASTER_PASSWORD: {
          value: `${props.opensearchSecretsKeyPath}:masterPassword`,
          type: BuildEnvironmentVariableType.SECRETS_MANAGER,
        },
        OPENSEARCH_READ_ONLY_USERNAME: {
          value: SecretValue.secretsManager(props.opensearchSecretsKeyPath, { jsonField: 'readonlyUserName' }).unsafeUnwrap(),
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        OPENSEARCH_READ_ONLY_PASSWORD: {
          value: SecretValue.secretsManager(props.opensearchSecretsKeyPath, { jsonField: 'readonlyPassword' }).unsafeUnwrap(),
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
       
        AUTH_CLIENT_URL: {
          value: props.authClientUrl,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        AUTH_CLIENT_ID: {
          value: props.authClientId,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        AUTH_CLIENT_ISSUER: {
          value: props.authClientIssuer,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
      },
      buildSpec: BuildSpec.fromObject({
        phases: {
          install: {
            'runtime-versions': {
            },
          },
          build: {
            commands: [
              'n stable',
              'echo SEARCH_INDEX = $SEARCH_INDEX',
              'echo OPENSEARCH_ENDPOINT = $OPENSEARCH_ENDPOINT',
              'echo OPENSEARCH_DOMAIN = $OPENSEARCH_DOMAIN',
              'echo OPENSEARCH_READ_ONLY_USERNAME = $OPENSEARCH_READ_ONLY_USERNAME',
              'echo OPENSEARCH_READ_ONLY_PASSWORD = $OPENSEARCH_READ_ONLY_PASSWORD',
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
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.maintainMetadataKeyBase + '*'),
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
      resources: ['arn:aws:s3:::cdktoolkit-stagingbucket-*', 'arn:aws:s3:::cdk*' ],
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

    console.log("opensearch Domain= ", opensearchDomainName)
    this.project.addToRolePolicy(NamespacedPolicy.opensearchInvoke(opensearchDomainName))
    
    this.action = new CodeBuildAction({
      actionName: 'BuildSite_and_CopyS3',
      input: props.inputBuildArtifact,
      extraInputs: props.extraBuildArtifacts,
      project: this.project,
      runOrder: 2,
    })
  }
}
