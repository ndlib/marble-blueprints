import { IVpc, Vpc } from "aws-cdk-lib/aws-ec2"
import { Cluster } from "aws-cdk-lib/aws-ecs"
import { ILogGroup, LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Bucket, BucketAccessControl, HttpMethods, IBucket } from "aws-cdk-lib/aws-s3"
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from "aws-cdk-lib"
import { StringParameter } from "aws-cdk-lib/aws-ssm"
import { Construct } from "constructs"


export interface IBaseStackProps extends StackProps {
  /**
   * The domain name to use for Route53 zones and recordsets and
   * ACM certificates
   */
  readonly domainName: string

  /**
   * If given, it will use the given Route53 Zone for this Vpc/DomainName
   * instead of creating one.
   *
   * Note: When using this option, this stack will not share the zone properties
   * via export/import to dependent stacks. Dependent stacks will need to
   * also be deployed with the same option used when the FoundationStack was
   * deployed.
   */
  readonly useExistingDnsZone?: boolean

  /**
   * If given, it will use the given Vpc instead of creating one.
   *
   * Note: When using this option, this stack will not share the vpc properties
   * via export/import to dependent stacks. Dependent stacks will need to
   * also be deployed with the same option used when the FoundationStack was
   * deployed.
   */
  readonly useVpcId?: string
}

export class FoundationStack extends Stack {
  /**
   * The VPC to place all services related to this application
   */
  public readonly vpc: IVpc

  /**
   * Shared cluster for any ECS tasks/services in this application
   */
  public readonly cluster: Cluster

  /**
   * The shared log bucket to place all logs for components in this application
   */
  public readonly logBucket: IBucket

  /**
   * The shared log group to place all logs for components in this application
   */
  public readonly logGroup: ILogGroup

  /**
   * Shared bucket for holding publicly available assets such as IIIF manifests and images.
   * Do not put secrets/private objects here.
   */
  public readonly publicBucket: IBucket

  /**
   * The path to an SSM parameter where the name of the public bucket will be stored.
   */
  public readonly publicBucketParam: string

  /**
   * Imported Wildcard certificateArn for all components of this application
   */
  public readonly certificateArn: string

  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props)

    if (props.useVpcId) {
      this.vpc = Vpc.fromLookup(this, 'VPC', { vpcId: props.useVpcId })
    } else {
      this.vpc = new Vpc(this, 'VPC', {
        maxAzs: 2,
      })
    }

    const certificateArnPath = `/all/dns/${props.domainName}/certificateArn`
    this.certificateArn = StringParameter.valueForStringParameter(this, certificateArnPath)

    this.cluster = new Cluster(this, 'Cluster', { vpc: this.vpc })

    this.logBucket = new Bucket(this, 'LogBucket', {
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY,
      lifecycleRules: [{ enabled: true, expiration: Duration.days(90), noncurrentVersionExpiration: Duration.days(1) }],
    })

    this.logGroup = new LogGroup(this, 'SharedLogGroup', {
      retention: RetentionDays.ONE_YEAR,
    })

    this.publicBucket = new Bucket(this, 'PublicBucket', {
      cors: [
        {
          allowedHeaders: [
            "*",
          ],
          allowedMethods: [
            HttpMethods.GET,
          ],
          allowedOrigins: [`*.${props.domainName}`],
          maxAge: 3600,
        }],
      serverAccessLogsBucket: this.logBucket,
      serverAccessLogsPrefix: 's3/data-broker/',
      websiteIndexDocument: 'index.html',
    })
    this.publicBucketParam = `/all/stacks/${this.stackName}/publicBucket`
    new StringParameter(this, 'PublicBucketParam', {
      stringValue: this.publicBucket.bucketName,
      parameterName: this.publicBucketParam,
    })
  }
}
