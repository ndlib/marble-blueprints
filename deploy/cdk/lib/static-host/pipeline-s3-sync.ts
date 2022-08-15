import { BuildSpec, LinuxBuildImage, PipelineProject, PipelineProjectProps, BuildEnvironmentVariableType, ComputeType } from 'aws-cdk-lib/aws-codebuild'
import { Artifact } from 'aws-cdk-lib/aws-codepipeline'
import { CodeBuildAction } from 'aws-cdk-lib/aws-codepipeline-actions'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Fn, Duration } from 'aws-cdk-lib'
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

  readonly openSearchDomainNameKeyPath: string
  readonly openSearchEndpointKeyPath: string
  readonly openSearchMasterUserNameKeyPath: string
  readonly openSearchMasterPasswordKeyPath: string
  readonly openSearchDomainPrefix: string
  readonly openSearchReadOnlyUserNameKeyPath: string
  readonly openSearchReadOnlyPasswordKeyPath: string
  
  readonly authClientUrl: string
  readonly authClientId: string
  readonly authClientIssuer: string
}

export class PipelineS3Sync extends Construct {
  public readonly project: PipelineProject
  public readonly action: CodeBuildAction

  constructor(scope: Construct, id: string, props: IPipelineS3SyncProps) {
    super(scope, id)
    const paramsPath = `/all/stacks/${props.targetStack}/`
    const staticHostPath = `/all/static-host/${props.targetStack}/`
    const subModName = props.extraBuildArtifacts?.find(x=>x!==undefined)?.artifactName

    // console.log("props.openSearchEndpointKeyPath=", props.openSearchEndpointKeyPath)
    // console.log("props.openSearchMasterUserNameKeyPath=", props.openSearchMasterUserNameKeyPath)
    // console.log("props.openSearchMasterPasswordKeyPath=", props.openSearchMasterPasswordKeyPath)    
    // console.log("props.openSearchReadOnlyUserNameKeyPath=", props.openSearchReadOnlyUserNameKeyPath)
    // console.log("props.openSearchReadOnlyPasswordKeyPath=", props.openSearchReadOnlyPasswordKeyPath)
    // console.log("openSearchEndpoint=", StringParameter.fromStringParameterAttributes(this, 'OpenSearchEndpoint', { parameterName: props.openSearchEndpointKeyPath }).stringValue)
    // console.log("openSearchMasterUserName=", StringParameter.fromStringParameterAttributes(this, 'OpenSearchMasterUserName', { parameterName: props.openSearchMasterUserNameKeyPath }).stringValue)
    // console.log("openSearchMasterPassword=", StringParameter.fromStringParameterAttributes(this, 'OpenSearchMasterPassword', { parameterName: props.openSearchMasterPasswordKeyPath }).stringValue)
    // console.log("openSearchReadOnlyUserName=", StringParameter.fromStringParameterAttributes(this, 'OpenSearchReadOnlyUserName', { parameterName: props.openSearchReadOnlyUserNameKeyPath }).stringValue)
    // console.log("openSearchReadOnlyPassword=", StringParameter.fromStringParameterAttributes(this, 'OpenSearchReadOnlyPassword', { parameterName: props.openSearchReadOnlyPasswordKeyPath }).stringValue)

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
        // Added from here for OpenSearch
        OPENSEARCH_DOMAIN_NAME: {
          value: props.openSearchDomainNameKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        OPENSEARCH_ENDPOINT: {
          value: props.openSearchEndpointKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        OPENSEARCH_MASTER_USERNAME: {
          value: props.openSearchMasterUserNameKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        OPENSEARCH_MASTER_PASSWORD: {
          value: props.openSearchMasterPasswordKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        OPENSEARCH_READ_ONLY_USERNAME: {
          value: props.openSearchReadOnlyUserNameKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        OPENSEARCH_READ_ONLY_PASSWORD: {
          value: props.openSearchReadOnlyPasswordKeyPath,
          type: BuildEnvironmentVariableType.PARAMETER_STORE,
        },
        OPENSEARCH_DOMAIN_NAME_KEY_PATH: {
          value: props.openSearchDomainNameKeyPath,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        OPENSEARCH_ENDPOINT_KEY_PATH: {
          value: props.openSearchEndpointKeyPath,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        OPENSEARCH_MASTER_USERNAME_KEY_PATH: {
          value: props.openSearchMasterUserNameKeyPath,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        OPENSEARCH_MASTER_PASSWORD_KEY_PATH: {
          value: props.openSearchMasterPasswordKeyPath,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        OPENSEARCH_READ_ONLY_USERNAME_KEY_PATH: {
          value: props.openSearchReadOnlyUserNameKeyPath,
          type: BuildEnvironmentVariableType.PLAINTEXT,
        },
        OPENSEARCH_READ_ONLY_PASSWORD_KEY_PATH: {
          value: props.openSearchReadOnlyPasswordKeyPath,
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
              'echo OPENSEARCH_INDEX = $OPENSEARCH_INDEX',
              'echo OPENSEARCH_ENDPOINT = $OPENSEARCH_ENDPOINT',
              'echo OPENSEARCH_READ_ONLY_USERNAME = $OPENSEARCH_READ_ONLY_USERNAME',
              'echo OPENSEARCH_READ_ONLY_PASSWORD = $OPENSEARCH_READ_ONLY_PASSWORD',
              'echo OPENSEARCH_DOMAIN_NAME_KEY_PATH = $OPENSEARCH_DOMAIN_NAME_KEY_PATH',
              'echo OPENSEARCH_ENDPOINT_KEY_PATH = $OPENSEARCH_ENDPOINT_KEY_PATH',
              'echo OPENSEARCH_MASTER_USERNAME_KEY_PATH = $OPENSEARCH_MASTER_USERNAME_KEY_PATH',
              'echo OPENSEARCH_MASTER_PASSWORD_KEY_PATH = $OPENSEARCH_MASTER_PASSWORD_KEY_PATH',
              'echo OPENSEARCH_READ_ONLY_USERNAME_KEY_PATH = $OPENSEARCH_READ_ONLY_USERNAME_KEY_PATH',
              'echo OPENSEARCH_READ_ONLY_PASSWORD_KEY_PATH = $OPENSEARCH_READ_ONLY_PASSWORD_KEY_PATH',
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
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.openSearchDomainNameKeyPath+ '*'),
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.openSearchEndpointKeyPath + '*'),
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.openSearchMasterUserNameKeyPath + '*'),
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.openSearchMasterPasswordKeyPath + '*'),
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.openSearchReadOnlyUserNameKeyPath + '*'),
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + props.openSearchReadOnlyPasswordKeyPath + '*'),
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
    if (props.openSearchDomainPrefix !== undefined) {
      this.project.addToRolePolicy(NamespacedPolicy.opensearchInvoke(props.openSearchDomainPrefix))
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
