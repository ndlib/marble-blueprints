import {
  CloudFrontAllowedMethods,
  CloudFrontWebDistribution,
  OriginAccessIdentity,
  ViewerCertificate,
  ViewerProtocolPolicy,
} from '@aws-cdk/aws-cloudfront'
import { PolicyStatement, Effect, CanonicalUserPrincipal } from '@aws-cdk/aws-iam'
import { CnameRecord } from '@aws-cdk/aws-route53'
import { Bucket, IBucket, BlockPublicAccess, HttpMethods } from '@aws-cdk/aws-s3'
import * as cdk from '@aws-cdk/core'
import { FoundationStack } from '../foundation/foundation-stack'

export interface IMultimediaAssetsStackProps extends cdk.StackProps {
  /**
   * Foundation stack which provides the log bucket and certificate to use.
   */
  readonly foundationStack: FoundationStack

  /**
   * The domain where assets will be hosted.
   */
  readonly domainName: string

  /**
   * If true, will create record in Route53 for the CNAME
   */
  readonly createDns: boolean

  /**
   * The namespace used for naming stacks and resources.
   */
  readonly namespace: string

  /**
   * Subdomain to host the site at. If not provided, will use <namespace>-multimedia
   */
  readonly hostnamePrefix?: string

  /**
   * How long to cache origin responses (in seconds).
   */
  readonly cacheTtl: number

  /**
   * Bucket to hold marble-content to be exposed using this API
   */
  readonly marbleContentBucketName: string
}

export class MultimediaAssetsStack extends cdk.Stack {
  /**
   * Audio and video files go here. The bucket is not public, but the CloudFront will treat them as public for now.
   * Some may be private later with a lambda authorizer.
   */
  public readonly multimediaBucket: IBucket

  /**
   * The cloudfront distribution.
   */
  public readonly cloudfront: CloudFrontWebDistribution

  /**
   * The full domain name where the cloudfront will be available from.
   */
  public readonly hostname: string

  constructor(scope: cdk.Construct, id: string, props: IMultimediaAssetsStackProps) {
    super(scope, id, props)

    const prefix = props.hostnamePrefix || `${props.namespace}-multimedia`
    this.hostname = `${prefix}.${props.foundationStack.hostedZone.zoneName}`

    // TODO:  Once we have made the transition to using the MarbleContentBucket, the MultimediaBucket will need to be removed.
    this.multimediaBucket = new Bucket(this, 'MultimediaBucket', {
      bucketName: `${prefix}-${this.account}`, // Bucket names must be unique, so account id helps ensure that
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [HttpMethods.GET],
          allowedOrigins: [ `*.${props.domainName}`],
          maxAge: 3600,
        },
      ],
      serverAccessLogsBucket: props.foundationStack.logBucket,
      serverAccessLogsPrefix: 's3/data-broker/',
    })

    const oai = new OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: `OAI for ${this.stackName}`,
    })
    this.multimediaBucket.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetBucket*', 's3:List*', 's3:GetObject*'],
        resources: [this.multimediaBucket.bucketArn, this.multimediaBucket.bucketArn + '/*'],
        principals: [new CanonicalUserPrincipal(oai.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
      }),
    )

    const marbleContentBucket = Bucket.fromBucketName(this, 'MarbleContentBucket', props.marbleContentBucketName)
    // Note: We need cors and serverAccessLogs added
    
    // This doesn't do anything.  I need to read the existing policy on the bucket and add to it.
    marbleContentBucket.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetBucket*', 's3:List*', 's3:GetObject*'],
        resources: [marbleContentBucket.bucketArn, marbleContentBucket.bucketArn + '/*'],
        principals: [new CanonicalUserPrincipal(oai.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
      }),
    )

    this.cloudfront = new CloudFrontWebDistribution(this, 'Distribution', {
      comment: this.hostname,
      loggingConfig: {
        bucket: props.foundationStack.logBucket,
        includeCookies: true,
        prefix: `web/${this.hostname}/`,
      },
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: marbleContentBucket,
            originAccessIdentity: oai,
            originPath: '/public-access',  // This will only share content in the folder named "public-access"
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              allowedMethods: CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
              compress: true,
              defaultTtl: cdk.Duration.seconds(props.cacheTtl),
            }
          ],
        },
      ],
      viewerCertificate: ViewerCertificate.fromAcmCertificate(props.foundationStack.certificate, {
        aliases: [this.hostname],
      }),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    })

    if (props.createDns) {
      new CnameRecord(this, 'MultimediaAssetsCnameRecord', {
        recordName: this.hostname,
        comment: this.hostname,
        domainName: this.cloudfront.distributionDomainName,
        zone: props.foundationStack.hostedZone,
        ttl: cdk.Duration.minutes(15),
      })
    }
  }
}
