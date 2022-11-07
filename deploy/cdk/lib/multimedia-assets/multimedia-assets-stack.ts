import {
  CloudFrontAllowedMethods,
  CloudFrontWebDistribution,
  OriginAccessIdentity,
  ViewerCertificate,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront'
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager'
import { PolicyStatement, Effect, CanonicalUserPrincipal } from 'aws-cdk-lib/aws-iam'
import { CnameRecord, HostedZone } from 'aws-cdk-lib/aws-route53'
import { Bucket, IBucket, BlockPublicAccess, HttpMethods } from 'aws-cdk-lib/aws-s3'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from "constructs"
import { FoundationStack } from '../foundation/foundation-stack'

export interface IMultimediaAssetsStackProps extends StackProps {
  /**
   * Foundation stack which provides the log bucket and certificate to use.
   */
  readonly foundationStack: FoundationStack

  /**
   * The domain where assets will be hosted.
   */
  readonly domainName: string

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

  readonly hostedZoneTypes: string[]
  readonly hostedZoneTypesTest: string[]
  readonly stage: string
}

export class MultimediaAssetsStack extends Stack {
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

  constructor(scope: Construct, id: string, props: IMultimediaAssetsStackProps) {
    super(scope, id, props)

    const prefix = props.hostnamePrefix || `${props.namespace}-multimedia`
    this.hostname = `${prefix}.${props.domainName}`

    // TODO:  Once we have made the transition to using the MarbleContentBucket, the MultimediaBucket will need to be removed.
    this.multimediaBucket = new Bucket(this, 'MultimediaBucket', {
      bucketName: `${prefix}-${this.account}`, // Bucket names must be unique, so account id helps ensure that
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
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
    // Note:  The following code doesn't do anything.  What we really need is to be able to read the existing bucket policy and add to it.
    // Unfortunately, CDK doesn't permit that.  In fact, according to https://github.com/aws/aws-cdk/issues/6548, CDK doesn't permit changes to buckets not created within the same cdk stack.
    // I am leaving this code here in case CDK eventually adds this functionality.
    // Note: For now, need CORS and policies added manually
    // marbleContentBucket.addToResourcePolicy(
    //   new PolicyStatement({
    //     effect: Effect.ALLOW,
    //     actions: ['s3:GetBucket*', 's3:List*', 's3:GetObject*'],
    //     resources: [marbleContentBucket.bucketArn, marbleContentBucket.bucketArn + '/*'],
    //     principals: [new CanonicalUserPrincipal(oai.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
    //   }),
    // )

    const certificate = Certificate.fromCertificateArn(this, 'WebsiteCertificate', props.foundationStack.certificateArn)
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
              defaultTtl: Duration.seconds(props.cacheTtl),
            },
          ],
        },
      ],
      viewerCertificate: ViewerCertificate.fromAcmCertificate(certificate, {
        aliases: [this.hostname],
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

    // Output API url to ssm so we can import it in the smoke test
    new StringParameter(this, 'ApiUrlParameter', {
      parameterName: `/all/${this.stackName}/api-url`,
      description: 'Path to root of the API gateway.',
      stringValue: this.cloudfront.distributionDomainName,
    })


  }
}
