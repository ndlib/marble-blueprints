import apigateway = require('@aws-cdk/aws-apigateway')
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam'
import { Function, Runtime } from "@aws-cdk/aws-lambda"
import { CnameRecord } from "@aws-cdk/aws-route53"
import { Construct, Duration, Fn, Stack, StackProps, Annotations } from "@aws-cdk/core"
import path = require('path')
import { FoundationStack } from '../foundation'
import { AssetHelpers } from '../asset-helpers'
import { MaintainMetadataStack } from '../maintain-metadata'

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

  private static ssmPolicy(keyPath: string): PolicyStatement {
    return new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ssm:GetParametersByPath"],
      resources: [
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + keyPath + '/*'),
      ],
    })
  }


  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props)


    if (props.hostnamePrefix.length > 63) {
      Annotations.of(this).addError(`Max length of hostnamePrefix is 63.  "${props.hostnamePrefix}" is too long.}`)
    }
    
    if (!RegExp('^$|(?!-)[a-zA-Z0-9-.]{1,63}(?<!-)').test(props.hostnamePrefix)) {
      Annotations.of(this).addError(`hostnamePrefix does not match legal pattern.`)
    }

    const graphqlApiUrlKeyPath = props.maintainMetadataStack.graphqlApiUrlKeyPath
    const graphqlApiKeyKeyPath = props.maintainMetadataStack.graphqlApiKeyKeyPath

    const apiName = props.hostnamePrefix
    const iiifApiBaseUrl = apiName + '.' + props.foundationStack.hostedZone.zoneName

    const iiifManifestLambda = new Function(this, 'IiifManifestLambdaFunction', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'manifest_lambda/')),
      description: 'Create iiif manifests real-time',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        GRAPHQL_API_URL_KEY_PATH: graphqlApiUrlKeyPath,
        GRAPHQL_API_KEY_KEY_PATH: graphqlApiKeyKeyPath,
        IIIF_API_BASE_URL: iiifApiBaseUrl,
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
    })

    // new API gateway created for testing purposes
    const api = new apigateway.RestApi(this, 'IIIFApiGateway', {
      restApiName: apiName,
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
    })
    const iiifManifestIntegration = new apigateway.LambdaIntegration(iiifManifestLambda)

    if (props.createDns) {
      new CnameRecord(this, `${id}-Route53CnameRecord`, {
        recordName: props.hostnamePrefix,
        domainName: api.domainName!.domainNameAliasDomainName, // cloudfront the api creates
        zone: props.foundationStack.hostedZone,
        ttl: Duration.minutes(15),
      })
    }
    // endpoints
    const manifest = api.root.addResource('manifest')
    const manifestId = manifest.addResource('{id}')
    manifestId.addMethod('GET', iiifManifestIntegration)

    const canvas = api.root.addResource('canvas')
    const canvasId = canvas.addResource('{id}')
    canvasId.addMethod('GET', iiifManifestIntegration)

    const annotationPage = api.root.addResource('annotation_page')
    const annotationPageId = annotationPage.addResource('{id}')
    annotationPageId.addMethod('GET', iiifManifestIntegration)

    const annotation = api.root.addResource('annotation')
    const annotationId = annotation.addResource('{id}')
    annotationId.addMethod('GET', iiifManifestIntegration)

  }
}
