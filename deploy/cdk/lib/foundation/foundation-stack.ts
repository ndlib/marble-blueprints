import { Certificate, CertificateValidation, ICertificate } from "@aws-cdk/aws-certificatemanager";
import { IVpc, Vpc } from "@aws-cdk/aws-ec2";
import { Cluster, ICluster } from "@aws-cdk/aws-ecs";
import { ILogGroup, LogGroup, RetentionDays } from "@aws-cdk/aws-logs";
import { HostedZone, IHostedZone } from "@aws-cdk/aws-route53";
import { Bucket, BucketAccessControl, HttpMethods, IBucket } from "@aws-cdk/aws-s3";
import { Construct, Duration, RemovalPolicy, Stack, StackProps } from "@aws-cdk/core";


export interface IBaseStackProps extends StackProps {
  /**
   * The domain name to use for Route53 zones and recordsets and
   * ACM certificates
   */
  readonly domainName: string;

  /**
   * Should this stack create a Route53 Zone? Default is false
   */
  readonly doCreateZone?: boolean;

  /**
   * If this stack import from an existing Route53 Zone, provide the zone id
   */
  readonly useDnsZone?: string;
}

export class FoundationStack extends Stack {
  /**
   * The VPC to place all services related to this application
   */
  public readonly vpc: IVpc;

  /**
   * The Route53 zone (only created if doCreateZone is true)
   */
  public readonly hostedZone: IHostedZone;

  /**
   * Wildcard certificate for all components of this application
   */
  public readonly certificate: ICertificate;

  /** 
   * Shared cluster for any ECS tasks/services in this application
   */
  public readonly cluster: ICluster;

  /**
   * The shared log bucket to place all logs for components in this application
   */
  public readonly logBucket: IBucket;

  /**
   * The shared log group to place all logs for components in this application
   */
  public readonly logGroup: ILogGroup;

  /**
   * Shared bucket for holding publicly available assets such as IIIF manifests and images. 
   * Do not put secrets/private objects here.
   */
  public readonly publicBucket: IBucket;

  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props);
    
    this.vpc = new Vpc(this, 'VPC');

    let certificateValidation = CertificateValidation.fromDns();
    if (props.doCreateZone) {
      this.hostedZone = new HostedZone(this, 'HostedZone', {
        zoneName: props.domainName,
      });
      certificateValidation = CertificateValidation.fromDns(this.hostedZone);

    }

    this.certificate = new Certificate(this, 'Certificate', {
      domainName: `*.${props.domainName}`,
      validation: certificateValidation,
    });

    this.cluster = new Cluster(this, 'Cluster', {
      vpc: this.vpc
    });

    this.logBucket = new Bucket(this, 'LogBucket', {
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY,
      lifecycleRules: [{ enabled: true, expiration: Duration.days(365 * 10), noncurrentVersionExpiration: Duration.days(1) }]
    });

    this.logGroup = new LogGroup(this, 'SharedLogGroup', {
      retention: RetentionDays.ONE_YEAR,
    })

    this.publicBucket = new Bucket(this, 'PublicBucket', {
      cors: [
        {
          allowedHeaders: [
            "*"
          ],
          allowedMethods: [
            HttpMethods.GET,
          ],
          allowedOrigins: [
            "*.library.nd.edu",
            "*.libraries.nd.edu",
            "*.cloudfront.net",
            "http://universalviewer.io"
          ],
          maxAge: 3600
        }],
      serverAccessLogsBucket: this.logBucket,
      serverAccessLogsPrefix: 's3/data-broker/',
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
    });

  }
}