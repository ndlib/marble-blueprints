import apigateway = require('@aws-cdk/aws-apigateway')
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam'
import { Function, Runtime } from "@aws-cdk/aws-lambda"
import { CnameRecord } from "@aws-cdk/aws-route53"
import { Construct, Duration, Fn, Stack, StackProps, Annotations } from "@aws-cdk/core"
import path = require('path')
import { ParameterType, StringParameter } from '@aws-cdk/aws-ssm'
import { FoundationStack } from '../foundation'
import { AssetHelpers } from '../asset-helpers'
import { MaintainMetadataStack } from '../maintain-metadata'
import { RestApi } from '@aws-cdk/aws-apigateway'

export interface IBaseStackProps extends StackProps {

  /**
   * The name of the foundation stack upon which this stack is dependent
   */
  readonly foundationStack: FoundationStack;

  /**
   * The domain name to use to reference and create Parameter Store parameters
   */
  // readonly domainName: string;

  /**
   * The sentry data source name (DSN)
   */
  readonly sentryDsn: string;

  /**
   * If True, will attempt to create a Route 53 DNS record for the CloudFront.
   */
  readonly createDns: boolean;

  /**
   * Hostname prefix for the manifest manifest lambda
   */
  readonly hostnamePrefix: string;

  /**
   * Hostname prefix for the public graphql API Gateway
   */
  readonly publicGraphqlHostnamePrefix: string;

  /** 
   * The filesystem root where we can find the source code for all our lambdas.  
   * e.g.  /user/me/source/marble-manifest-pipeline/
   * The path for each individual lambda will be appended to this.
   */
  readonly lambdaCodeRootPath: string;

  /**
   * The name of the maintain metadata stack upon which this stack is dependent
   */
  readonly maintainMetadataStack: MaintainMetadataStack;
}

export class ManifestLambdaStack extends Stack {
  public readonly apiName: string
  public readonly publicApiName: string
  public readonly publicGraphqlApiKeyPath: string
  public readonly publicApi: RestApi
  public readonly privateApi: RestApi

  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props)

    // TODO: Remove naming of these based on prefix and let cloudformation handle names.
    // This is forcing dependent stacks to be deployed using the same context overrides
    // as when this stack was deployed since this is determined at synth time instead of
    // creating an export at deploy time. For example, the service-levels and dashboards
    // stacks have to additionally add:
    //   -c "manifestLambda:publicGraphqlHostnamePrefix=marbleb-prod-public-graphql"
    // Once fixed, update the readme to remove these overrides from the example commands
    // for those two stacks.
    this.apiName = props.hostnamePrefix
    this.publicApiName = props.publicGraphqlHostnamePrefix

    if (props.hostnamePrefix.length > 63) {
      Annotations.of(this).addError(`Max length of hostnamePrefix is 63.  "${props.hostnamePrefix}" is too long.}`)
    }
    
    if (!RegExp('^$|(?!-)[a-zA-Z0-9-.]{1,63}(?<!-)').test(props.hostnamePrefix)) {
      Annotations.of(this).addError(`hostnamePrefix does not match legal pattern.`)
    }

    const graphqlApiUrlKeyPath = props.maintainMetadataStack.graphqlApiUrlKeyPath
    const graphqlApiKeyKeyPath = props.maintainMetadataStack.graphqlApiKeyKeyPath

    const iiifApiBaseUrl = props.hostnamePrefix + '.' + props.foundationStack.hostedZone.zoneName
    const graphqlApiBaseUrl = this.publicApiName + '.' + props.foundationStack.hostedZone.zoneName

    // Create iiifManifestLambda and associated api and endpoints
    const iiifManifestLambda = new Function(this, 'IiifManifestLambdaFunction', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'manifest_lambda/')),
      description: 'Create iiif manifests real-time',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        GRAPHQL_API_URL_KEY_PATH: graphqlApiUrlKeyPath,
        GRAPHQL_API_KEY_KEY_PATH: graphqlApiKeyKeyPath,
        IIIF_API_BASE_URL: 'https://' + iiifApiBaseUrl,
        SENTRY_DSN: props.sentryDsn,
      },
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'ssm:GetParameter',
            'ssm:GetParameters',
            'ssm:GetParametersByPath',
          ],
          resources: [
            Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + graphqlApiUrlKeyPath + '*'),
            Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + graphqlApiKeyKeyPath + '*'),
          ],
        }),
      ],
      timeout: Duration.seconds(90),
      memorySize: 1024,
    })

    this.privateApi = new apigateway.RestApi(this, 'IIIFApiGateway', {
      restApiName: this.apiName,
      defaultCorsPreflightOptions: {
        allowOrigins: ["*"],
        allowCredentials: false,
        statusCode: 200,
      },
      domainName: {
        certificate: props.foundationStack.certificate,
        domainName: iiifApiBaseUrl,
      },
      endpointExportName: `${this.stackName}-api-url`,
      deployOptions: { metricsEnabled: true },
    })
    const iiifManifestIntegration = new apigateway.LambdaIntegration(iiifManifestLambda)

    if (props.createDns) {
      new CnameRecord(this, `${id}-Route53CnameRecord`, {
        recordName: props.hostnamePrefix,
        domainName: this.privateApi.domainName!.domainNameAliasDomainName, // cloudfront the api creates
        zone: props.foundationStack.hostedZone,
        ttl: Duration.minutes(15),
      })
    }
    // endpoints
    const manifest = this.privateApi.root.addResource('manifest')
    const manifestId = manifest.addResource('{id}')
    manifestId.addMethod('GET', iiifManifestIntegration)

    const canvas = this.privateApi.root.addResource('canvas')
    const canvasId = canvas.addResource('{id}')
    canvasId.addMethod('GET', iiifManifestIntegration)

    const annotationPage = this.privateApi.root.addResource('annotation_page')
    const annotationPageId = annotationPage.addResource('{id}')
    annotationPageId.addMethod('GET', iiifManifestIntegration)

    const annotation = this.privateApi.root.addResource('annotation')
    const annotationId = annotation.addResource('{id}')
    annotationId.addMethod('GET', iiifManifestIntegration)


    // Create publicGraphqlLambda and associated api and endpoints
    const publicGraphqlLambda = new Function(this, 'PublicGraphqlLambdaFunction', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'public_graphql_lambda/')),
      description: 'Appends API keys and queries named AppSync resolvers',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        GRAPHQL_API_URL_KEY_PATH: graphqlApiUrlKeyPath,
        GRAPHQL_API_KEY_KEY_PATH: graphqlApiKeyKeyPath,
        SENTRY_DSN: props.sentryDsn,
      },
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'ssm:GetParameter',
            'ssm:GetParameters',
            'ssm:GetParametersByPath',
          ],
          resources: [
            Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + graphqlApiUrlKeyPath + '*'),
            Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + graphqlApiKeyKeyPath + '*'),
          ],
        }),
      ],
      timeout: Duration.seconds(90),
      memorySize: 1024,
    })

    // Create API Gateway
    this.publicApi = new apigateway.RestApi(this, 'PublicGraphqlApiGateway', {
      restApiName: this.publicApiName,
      defaultCorsPreflightOptions: {
        allowOrigins: ["*"],
        allowCredentials: false,
        statusCode: 200,
      },
      domainName: {
        certificate: props.foundationStack.certificate,
        domainName: graphqlApiBaseUrl,
      },
      endpointExportName: `${this.stackName}-graphql-api-url`,
      deployOptions: { metricsEnabled: true },
    })
    const publicGraphqlIntegration = new apigateway.LambdaIntegration(publicGraphqlLambda)

    // Create DNS entry
    if (props.createDns) {
      new CnameRecord(this, `${this.publicApiName}-Route53CnameRecord`, {
        recordName: props.publicGraphqlHostnamePrefix,
        domainName: this.publicApi.domainName!.domainNameAliasDomainName, // cloudfront the api creates
        zone: props.foundationStack.hostedZone,
        ttl: Duration.minutes(15),
      })
    }

    // Create endpoints
    const query = this.publicApi.root.addResource('query')
    const queryId = query.addResource('{id}')
    queryId.addMethod('POST', publicGraphqlIntegration)

    // Create SSM keys
    this.publicGraphqlApiKeyPath = `/all/stacks/${this.stackName}/public-graphql-api-url`
    new StringParameter(this, 'SSMPublicGraphqlApiUrl', {
      type: ParameterType.STRING,
      parameterName: this.publicGraphqlApiKeyPath,
      stringValue: this.publicApi.domainName!.domainNameAliasDomainName, // cloudfront the api creates
      description: 'Public GraphQL API URL',
    })

  }
}
