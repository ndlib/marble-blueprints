import {
  CloudFrontAllowedMethods,
  CloudFrontWebDistribution,
  LambdaEdgeEventType,
  OriginAccessIdentity,
  SecurityPolicyProtocol,
  SSLMethod,
  ViewerCertificate,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront'
import lambda = require('aws-cdk-lib/aws-lambda')
import s3 = require('aws-cdk-lib/aws-s3')
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib'

import { FoundationStack } from '../foundation'
import { CnameRecord, HostedZone } from 'aws-cdk-lib/aws-route53'
import { Certificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager'
import { AssetHelpers } from '../asset-helpers'
import { Construct } from 'constructs'
export interface IStaticHostStackProps extends StackProps {
  readonly contextEnvName: string
  readonly foundationStack: FoundationStack
  readonly namespace: string
  readonly hostnamePrefix: string
  readonly lambdaCodePath: string
  readonly domainName: string
  /**
   * Optional SSM path to certificateARN 
   */
  readonly certificateArnPath?: string
  /**
   * Optional domainName override
   */
  readonly domainNameOverride?: string

  /**
   * Optional additional aliases
   */
  readonly additionalAliases?: Array<string>
  readonly hostedZoneTypes: string[]
  readonly opensearchSecretsKeyPath: string
  readonly hostedZoneTypesTest: string[]
  readonly stage: string
}

export class StaticHostStack extends Stack {
  /**
   * The S3 bucket that will hold website contents.
   */
  public readonly bucket: s3.Bucket

  /**
   * The cloudfront distribution.
   */
  public readonly cloudfront: CloudFrontWebDistribution

  /**
   * The cloudfront distribution domain name.
   */
  public readonly hostname: string

  /**
   * Lambda used for redirecting certain routes with Cloudfront.
   */
  public readonly spaRedirectionLambda: lambda.Function

  constructor(scope: Construct, id: string, props: IStaticHostStackProps) {
    super(scope, id, props)

    this.spaRedirectionLambda = new lambda.Function(this, 'SPARedirectionLambda', {
      code: AssetHelpers.codeFromAsset(this, props.lambdaCodePath),
      description: 'Basic rewrite rule to send directory requests to appropriate locations in the SPA.',
      handler: 'handler.handler',
      runtime: lambda.Runtime.NODEJS_16_X,
    })

    const domainName = props.domainNameOverride || props.domainName
    this.hostname = `${props.hostnamePrefix || this.stackName}.${domainName}`
    const aliases = [
      this.hostname,
      ...(props.additionalAliases ?? []),
    ]
    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      serverAccessLogsBucket: props.foundationStack.logBucket,
      serverAccessLogsPrefix: `s3/${this.hostname}/`,
    })

    let websiteCertificate: ICertificate
    if (props.certificateArnPath) {
      const certificateArn = StringParameter.valueForStringParameter(this, props.certificateArnPath)
      websiteCertificate = Certificate.fromCertificateArn(this, 'WebsiteCertificate', certificateArn)
    } else {
      websiteCertificate = Certificate.fromCertificateArn(this, 'WebsiteCertificate', props.foundationStack.certificateArn)
    }

    // TODO: Enable additional metrics on all of these cloudfronts once https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/545
    // is complete and cdk adds support for this. Until then, we'll have to manually enable additional metrics for each stack that uses
    // a StaticHost
    this.cloudfront = new CloudFrontWebDistribution(this, 'Distribution', {
      comment: this.hostname,
      errorConfigurations: [
        {
          errorCode: 403,
          responseCode: 404,
          responsePagePath: '/404.html',
          errorCachingMinTtl: 300,
        },
        {
          errorCode: 404,
          responseCode: 404,
          responsePagePath: '/404.html',
          errorCachingMinTtl: 300,
        },
      ],
      loggingConfig: {
        bucket: props.foundationStack.logBucket,
        includeCookies: true,
        prefix: `web/${this.hostname}`,
      },
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: this.bucket,
            originAccessIdentity: new OriginAccessIdentity(this, 'OriginAccessIdentity', {
              comment: `Static assets in ${this.stackName}`,
            }),
          },
          behaviors: [
            {
              allowedMethods: CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
              compress: true,
              defaultTtl: (props.contextEnvName === 'dev') ? Duration.seconds(0) : Duration.days(1),
              isDefaultBehavior: true,
              lambdaFunctionAssociations: [
                {
                  eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                  lambdaFunction: this.spaRedirectionLambda.currentVersion,
                },
              ],
              forwardedValues: {
                cookies: {
                  forward: 'none',
                },
                queryString: true,
                queryStringCacheKeys: [
                  'synthetics-timestamp',
                ],
              },
            },
          ],
        },
      ],
      viewerCertificate: ViewerCertificate.fromAcmCertificate(websiteCertificate, {
        aliases,
        securityPolicy: SecurityPolicyProtocol.TLS_V1_1_2016,
        sslMethod: SSLMethod.SNI,
      }),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    })

    // Create DNS entries for each hosted zone
    for (const hostedZoneType of ['public', 'private']) {
      if (props.hostedZoneTypes.includes(hostedZoneType)) {
        const hostedZoneIdPath = `/all/dns/${props.domainName}/${hostedZoneType}/zoneId`
        const hostedZoneId = StringParameter.valueForStringParameter(this, hostedZoneIdPath)

        new CnameRecord(this, `ServiceCNAME${hostedZoneType}`, {
          recordName: this.hostname,
          comment: this.hostname,
          domainName: this.cloudfront.distributionDomainName,
          zone: HostedZone.fromHostedZoneAttributes(this, `ImportedHostedZone${hostedZoneType}`, {
            hostedZoneId: hostedZoneId as string,
            zoneName: props.domainName,
          }),
          ttl: Duration.minutes(15),
        })
      }
    }

    new StringParameter(this, 'BucketParameter', {
      parameterName: `/all/stacks/${this.stackName}/site-bucket-name`,
      description: 'Bucket where the stack website deploys to.',
      stringValue: this.bucket.bucketName,
    })

    new StringParameter(this, 'DistributionParameter', {
      parameterName: `/all/stacks/${this.stackName}/distribution-id`,
      description: 'ID of the CloudFront distribution.',
      stringValue: this.cloudfront.distributionId,
    })

    // Output API url to ssm so we can import it in the smoke test
    new StringParameter(this, 'WebsiteUrlParameter', {
      parameterName: `/all/${this.stackName}/website-url`,
      description: 'Path to root of the API gateway.',
      stringValue: this.cloudfront.distributionDomainName,
    })

    new CfnOutput(this, 'DistributionDomainName', {
      value: this.cloudfront.distributionDomainName,
      description: 'The cloudfront distribution domain name.',
    })
  }
}
