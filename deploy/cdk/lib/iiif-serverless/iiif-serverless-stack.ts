import apigateway = require('@aws-cdk/aws-apigateway')
import { CfnOutput, Construct, Duration, Fn, NestedStack, NestedStackProps, Stack, StackProps } from "@aws-cdk/core"
import { FoundationStack } from "../foundation"
import { CnameRecord } from "@aws-cdk/aws-route53"
import { Function, Runtime } from "@aws-cdk/aws-lambda"
import { AssetHelpers } from '../asset-helpers'
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam'
import * as path from "path"


export interface IIiifServerlessStackProps extends StackProps {
  /**
   * The path to the root of the local copy of the serverless-iiif repo.
   */
  readonly serverlessIiifSrcPath: string

  /**
   * The subdomain to use when creating a custom domain for the API
   */
  readonly hostnamePrefix: string

  /**
   * Reference to the foundation stack to get the domain and cert from
   */
  readonly foundationStack: FoundationStack

  /**
   * If true, will attempt to create a CNAME for the service in the
   * Route53 zone created in the foundation stack
   */
  readonly createDns: boolean

  /**
   * Path in SSM where parameters for this stack are stored.
   */
  readonly paramPathPrefix: string
}

export interface IIiifApiStackProps extends NestedStackProps {
  readonly serverlessIiifSrcPath: string
  readonly foundationStack: FoundationStack
  readonly paramPathPrefix: string
  readonly hostnamePrefix: string
  readonly createDns: boolean
}

/**
 * Creates an Api stack using the template from the source repo
 */
class ApiStack extends NestedStack {
  readonly apiName: string

  constructor(scope: Construct, id: string, props: IIiifApiStackProps) {
    super(scope, id, props)

    this.apiName = `${this.stackName}-api`

    const iiifFunc = new Function(this, "IiifFunction", {
      runtime: Runtime.NODEJS_12_X,
      code: AssetHelpers.codeFromAsset(this, path.join(props.serverlessIiifSrcPath, 'src/')),
      handler: 'index.handler',
      timeout: Duration.seconds(10),
      memorySize: 3072,
      environment: {
        tiffBucket: props.foundationStack.publicBucket.bucketName,
      },
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            's3:ListBucket',
            's3:GetBucketLocation',
          ],
          resources: [
            props.foundationStack.publicBucket.bucketArn,
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            's3:GetObject',
            's3:GetObjectACL',
          ],
          resources: [
            `${props.foundationStack.publicBucket.bucketArn}/*`,
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['s3:ListAllMyBuckets'],
          resources: ['*'],
        }),
      ],
    })

    const fqdn = `${props.hostnamePrefix}.${props.foundationStack.hostedZone.zoneName}`
    const apiProps = {
      restApiName: this.apiName,
      handler: iiifFunc,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'OPTIONS'],
      },
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      domainName: {
        domainName: fqdn,
        certificate: props.foundationStack.certificate,
      },
      deployOptions: {
        cacheClusterEnabled: true,
        cacheClusterSize: '0.5',
        cacheTtl: Duration.seconds(3600),
      },
      binaryMediaTypes: ["*/*"],
    }

    const iiifApi = new apigateway.LambdaRestApi(this, 'IiifApi', apiProps)
    const integration = new apigateway.LambdaIntegration(iiifFunc,
      {
        proxy: true,
    })
    const rootPath = iiifApi.root.addResource('iiif')
    const twoPath = rootPath.addResource('2')

    // /iiif/2/{id}
    const idPath = twoPath.addResource('{id}')
    idPath.addMethod('GET')

    // /iiif2/{id}/info.json
    const infoPath = idPath.addResource('info.json')
    infoPath.addMethod('GET', integration)

    // /iiif/2/{id}/{proxy+}
    const idProxyPath = idPath.addProxy({ anyMethod: false })
    idProxyPath.addMethod('GET', integration, {
      methodResponses: [{
        'statusCode': '200',
        'responseParameters': {
            'method.response.header.Authorization': false,
            'method.response.header.Cookie': false,
            'method.response.header.Origin': false,
        },
        'responseModels': { 'application/json': apigateway.Model.EMPTY_MODEL },
      }],
    })
    if (props.createDns) {
      new CnameRecord(this, `HostnamePrefix-Route53CnameRecord`, {
        recordName: props.hostnamePrefix,
        // domainName: fqdn,
        domainName: iiifApi.domainName!.domainNameAliasDomainName, // cloudfront the api creates
        zone: props.foundationStack.hostedZone,
        ttl: Duration.minutes(15),
      })
    }

    new CfnOutput(this, 'ApiEndpointUrl', {
      value: `${iiifApi.url}/iiif/2/`,
      description: 'IIIF Endpoint URL',
    })
    new CfnOutput(this, 'ApiId', {
      value: iiifApi.restApiId,
      description: 'API Gateway ID',
    })
  }
}


/**
 * Creates a serverless-iiif stack with a custom domain
 */
export class IiifServerlessStack extends Stack {
  readonly apiStack: ApiStack

  constructor(scope: Construct, id: string, props: IIiifServerlessStackProps) {
    super(scope, id, props)
    this.apiStack = new ApiStack(this, 'IiifApiStack', props)
  }
}
