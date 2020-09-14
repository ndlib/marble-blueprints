import {
  CloudFrontAllowedMethods,
  CloudFrontWebDistribution,
  LambdaEdgeEventType,
  OriginAccessIdentity,
  SecurityPolicyProtocol,
  SSLMethod,
  ViewerCertificate,
  ViewerProtocolPolicy,
} from '@aws-cdk/aws-cloudfront'
import lambda = require('@aws-cdk/aws-lambda')
import s3 = require('@aws-cdk/aws-s3')
import ssm = require('@aws-cdk/aws-ssm')
import cdk = require('@aws-cdk/core')
import { FoundationStack } from '../foundation'
import { CnameRecord } from '@aws-cdk/aws-route53'

export interface IStaticHostStackProps extends cdk.StackProps {
  readonly contextEnvName: string
  readonly foundationStack: FoundationStack
  readonly namespace: string
  readonly hostnamePrefix: string
  readonly lambdaCodePath: string
  readonly createDns: boolean
}

export class StaticHostStack extends cdk.Stack {
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

  constructor(scope: cdk.Construct, id: string, props: IStaticHostStackProps) {
    super(scope, id, props)

    this.spaRedirectionLambda = new lambda.Function(this, 'SPARedirectionLambda', {
      functionName: `${this.stackName}-spa-redirection`,
      code: lambda.Code.fromAsset(props.lambdaCodePath),
      description: 'Basic rewrite rule to send directory requests to appropriate locations in the SPA.',
      handler: 'handler.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
    })

    this.hostname = `${props.hostnamePrefix || this.stackName}.${props.foundationStack.hostedZone.zoneName}`

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      serverAccessLogsBucket: props.foundationStack.logBucket,
      serverAccessLogsPrefix: `s3/${this.hostname}`,
    })

    this.cloudfront = new CloudFrontWebDistribution(this, 'Distribution', {
      comment: this.hostname,
      errorConfigurations: [
        {
          errorCode: 403,
          responseCode: 404,
          responsePagePath: '/404.html',
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
              defaultTtl: (props.contextEnvName === 'dev') ? cdk.Duration.seconds(0) : cdk.Duration.days(1),
              isDefaultBehavior: true,
              lambdaFunctionAssociations: [
                {
                  eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                  lambdaFunction: this.spaRedirectionLambda.currentVersion,
                },
              ],
            },
          ],
        },
      ],
      viewerCertificate: ViewerCertificate.fromAcmCertificate(props.foundationStack.certificate, {
        aliases: [this.hostname],
        securityPolicy: SecurityPolicyProtocol.TLS_V1_1_2016,
        sslMethod: SSLMethod.SNI,
      }),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    })

    // Create DNS record (conditionally)
    if (props.createDns) {
      new CnameRecord(this, 'ServiceCNAME', {
        recordName: this.hostname,
        comment: this.hostname,
        domainName: this.cloudfront.distributionDomainName,
        zone: props.foundationStack.hostedZone,
        ttl: cdk.Duration.minutes(15),
      })
    }

    new ssm.StringParameter(this, 'BucketParameter', {
      parameterName: `/all/stacks/${this.stackName}/site-bucket-name`,
      description: 'Bucket where the stack website deploys to.',
      stringValue: this.bucket.bucketName,
    })

    new ssm.StringParameter(this, 'DistributionParameter', {
      parameterName: `/all/stacks/${this.stackName}/distribution-id`,
      description: 'ID of the CloudFront distribution.',
      stringValue: this.cloudfront.distributionId,
    })

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.cloudfront.domainName,
      description: 'The cloudfront distribution domain name.',
    })
  }
}
