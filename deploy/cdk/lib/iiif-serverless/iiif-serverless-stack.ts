import apigateway = require('aws-cdk-lib/aws-apigateway')
import { CfnOutput, Duration, NestedStack, NestedStackProps, Stack, StackProps } from "aws-cdk-lib"
import { FoundationStack } from "../foundation"
import { CnameRecord, HostedZone } from "aws-cdk-lib/aws-route53"
import { Function, Runtime } from "aws-cdk-lib/aws-lambda"
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager'
import { Construct } from "constructs"
import { AssetHelpers } from '../asset-helpers'
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
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
   * Path in SSM where parameters for this stack are stored.
   */
  readonly paramPathPrefix: string
  readonly domainName: string
  readonly hostedZoneTypes: string[]
}

export interface IIiifApiStackProps extends NestedStackProps {
  readonly serverlessIiifSrcPath: string
  readonly foundationStack: FoundationStack
  readonly paramPathPrefix: string
  readonly hostnamePrefix: string
  readonly domainName: string
  readonly hostedZoneTypes: string[]
}

/**
 * Creates an Api stack using CDK code defined here (formerly from the template from the source repo)
 */
class ApiStack extends NestedStack {
  readonly apiName: string

  constructor(scope: Construct, id: string, props: IIiifApiStackProps) {
    super(scope, id, props)

    this.apiName = `${this.stackName}-api`

    const iiifFunc = new Function(this, "IiifFunction", {
      runtime: Runtime.NODEJS_14_X,
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

    const fqdn = `${props.hostnamePrefix}.${props.domainName}`
    const certificate = Certificate.fromCertificateArn(this, 'WebsiteCertificate', props.foundationStack.certificateArn)

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
        certificate: certificate,
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

    // Create DNS entries for each hosted zone
    for (const hostedZoneType of ['public', 'private']) {
      if (props.hostedZoneTypes.includes(hostedZoneType)) {
        const hostedZoneIdPath = `/all/dns/${props.domainName}/${hostedZoneType}/zoneId`
        const hostedZoneId = StringParameter.valueForStringParameter(this, hostedZoneIdPath)

        new CnameRecord(this, `ServiceCNAME${hostedZoneType}`, {
          recordName: props.hostnamePrefix,
          comment: props.hostnamePrefix,
          domainName: iiifApi.domainName!.domainNameAliasDomainName, // cloudfront the api creates
          zone: HostedZone.fromHostedZoneAttributes(this, `ImportedHostedZone${hostedZoneType}`, {
            hostedZoneId: hostedZoneId as string,
            zoneName: props.domainName,
          }),
          ttl: Duration.minutes(15),
        })
      }
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
