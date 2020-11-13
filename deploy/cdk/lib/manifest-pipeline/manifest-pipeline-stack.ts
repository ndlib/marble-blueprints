import { CloudFrontAllowedMethods, CloudFrontWebDistribution, HttpVersion, LambdaEdgeEventType, OriginAccessIdentity, PriceClass, ViewerCertificate } from '@aws-cdk/aws-cloudfront'
import { SfnStateMachine } from "@aws-cdk/aws-events-targets"
import { CanonicalUserPrincipal, Effect, PolicyStatement } from '@aws-cdk/aws-iam'
import { Code, Function, Runtime, Version } from "@aws-cdk/aws-lambda"
import { CnameRecord } from "@aws-cdk/aws-route53"
import { Bucket, HttpMethods, IBucket } from "@aws-cdk/aws-s3"
import { ParameterType, StringParameter } from '@aws-cdk/aws-ssm'
import { Choice, Condition, Errors, Fail, JsonPath, LogLevel, Parallel, Pass, Result, StateMachine, Succeed } from '@aws-cdk/aws-stepfunctions'
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks'
import { Construct, Duration, Fn, Stack, StackProps, CfnOutput, Annotations } from "@aws-cdk/core"
import fs = require('fs')
import path = require('path')
import { FoundationStack } from '../foundation'
import { Rule, Schedule } from "@aws-cdk/aws-events"
import dynamodb = require('@aws-cdk/aws-dynamodb')

export interface IBaseStackProps extends StackProps {


  /**
   * The name of the foundation stack upon which this stack is dependent
   */
  readonly foundationStack: FoundationStack;

  /**
   * The domain name to use to reference and create Parameter Store parameters
   */
  readonly domainName: string;

  /**
   * The host name of the IIIF Image Server
   */
  readonly imageServerHostname: 'AWS::SSM::Parameter::Value<String>'

  /**
   * The ssm path to look for the marble data processing config from
   */
  readonly marbleProcessingKeyPath: string;

  /**
   * Email address notification emails are sent from
   */
  readonly noReplyEmailAddr: string;

  /**
   * The sentry data source name (DSN)
   */
  readonly sentryDsn: string;

  /**
   * The name of the bucket that rarebooks images are in for the search process
   */
  readonly rBSCS3ImageBucketName: string;

  /**
   * The ssm path to look for the google team drive credentials and drive-id
   */
  readonly googleKeyPath: string;

  /**
   * The ssm path to look for the EmbARK museum credentials
   */
  readonly museumKeyPath: string;

  /**
   * The ssm path to look for the CurateND credentials
   */
  readonly curateKeyPath: string;

  /**
   * If True, will attempt to create a Route 53 DNS record for the CloudFront.
   */
  readonly createDns: boolean;

  /**
   * Hostname prefix for the manifest bucket CDN
   */
  readonly hostnamePrefix: string;

  /**
   * If True, will attempt to create a Rule to harvest metadata and create standard json.
   */
  readonly createEventRules: boolean;

  /** 
   * The filesystem root where we can find the source code for all our lambdas.  
   * e.g.  /user/me/source/marble-manifest-pipeline/
   * The path for each individual lambda will be appended to this.
   */
  readonly lambdaCodeRootPath: string;

  /**
   * The ssm path to look for the application config from
   */
  readonly appConfigPath: string;

  /**
   * The time to live for records in the metadata dynamodb table
   */
  readonly metadataTimeToLiveDays: string;

  /**
   * The time to live for records in the files dynamodb table
   */
  readonly filesTimeToLiveDays: string;


}

export class ManifestPipelineStack extends Stack {


  private static ssmPolicy(keyPath: string): PolicyStatement {
    return new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ssm:GetParametersByPath"],
      resources: [
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + keyPath + '/*'),
      ],
    })
  }

  private static allowListBucketPolicy(bucketName: string): PolicyStatement {
    return new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:ListObjects", "s3:ListBucket"],
      resources: [
        Fn.sub(`arn:aws:s3:::${bucketName}`),
        Fn.sub(`arn:aws:s3:::${bucketName}/*`),
      ],
    })
  }


  /**
   * The shared bucket to place all items for and during processing.
   */
  public readonly processBucket: IBucket

  /**
   * The shared bucket to place all items after processing.  Manifests, standard json, and images are read from this bucket.
   */
  public readonly manifestBucket: IBucket

  /**
   * The distribution for the manifests
   */
  public readonly distribution: CloudFrontWebDistribution

  /**
   * 
   * The dynamodb table for metadata harvested from source systems
   */
  public readonly metadataDynamoTable: dynamodb.Table

  /**
   * 
   * The dynamodb table to hold metadata augmented by users outside of source systems
   */
  public readonly metadataAugmentationDynamoTable: dynamodb.Table

  /**
   * 
   * The dynamodb table to hold file information
   */
  public readonly filesDynamoTable: dynamodb.Table

  
  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props)

    if (props.hostnamePrefix.length > 63) {
      Annotations.of(this).addError(`Max length of hostnamePrefix is 63.  "${props.hostnamePrefix}" is too long.}`)
    }
    
    if (!RegExp('^$|(?!-)[a-zA-Z0-9-.]{1,63}(?<!-)').test(props.hostnamePrefix)) {
      Annotations.of(this).addError(`hostnamePrefix does not match legal pattern.`)
    }

    // Create Dynamo Tables
    this.filesDynamoTable = new dynamodb.Table(this, 'files', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expireTime',
    })
    this.filesDynamoTable.addGlobalSecondaryIndex({
      indexName: 'fileId',
      partitionKey: {
        name: 'fileId',
        type: dynamodb.AttributeType.STRING,
      },
    })
    this.filesDynamoTable.addGlobalSecondaryIndex({
      indexName: 'objectFileGroupIdIndex',
      partitionKey: {
        name: 'objectFileGroupId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sequence',
        type: dynamodb.AttributeType.NUMBER,
      },
    })
    new StringParameter(this, 'FilesTTLDaysParam', {
      type: ParameterType.STRING,
      parameterName: `/all/stacks/${this.stackName}/files-time-to-live-days`,
      stringValue: props.filesTimeToLiveDays,
      description: 'Time To live for files dynamodb records',
    })

    this.metadataDynamoTable = new dynamodb.Table(this, 'metadata', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expireTime',
    })
    this.metadataDynamoTable.addGlobalSecondaryIndex({
      indexName: 'parentIdIndex',
      partitionKey: {
        name: 'parentId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sequence',
        type: dynamodb.AttributeType.NUMBER,
      },
    })
    new StringParameter(this, 'MetadataTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/metadata-tablename`,
      stringValue: this.metadataDynamoTable.tableName,
    })
    new StringParameter(this, 'MetadataTTLDaysParam', {
      type: ParameterType.STRING,
      parameterName: `/all/stacks/${this.stackName}/metadata-time-to-live-days`,
      stringValue: props.metadataTimeToLiveDays,
      description: 'Time To live for metadata dynamodb records',
    })



    this.metadataAugmentationDynamoTable = new dynamodb.Table(this, 'metadataAugmentation', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      pointInTimeRecovery: true,
    })
    new StringParameter(this, 'MetadataAugmentationTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/metadata-augmentation-tablename`,
      stringValue: this.metadataAugmentationDynamoTable.tableName,
    })

     // Create Origin Access Id
    const originAccessId = new OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: Fn.sub('Static assets in ${AWS::StackName}'),
    })

    // Create buckets needed
    const processBucket = new Bucket(this, 'ProcessBucket', {
      serverAccessLogsBucket: props.foundationStack.logBucket,
      serverAccessLogsPrefix: 's3/data-broker/',
    })
    // Manually control and force the export of this bucket
    const processBucketExportName = `${this.stackName}:ProcessBucketArn`
    new CfnOutput(this, 'ProcessBucketArnOutput', {
      value: processBucket.bucketArn,
      exportName: processBucketExportName,
    })
    // Construct the import for anything that references this bucket
    this.processBucket = Bucket.fromBucketArn(this, 'BucketImport', Fn.importValue(processBucketExportName))

    this.manifestBucket = new Bucket(this, 'ManifestBucket', {
      cors: [
        {
          allowedHeaders: [
            "Authorization",
          ],
          allowedMethods: [
            HttpMethods.GET,
          ],
          allowedOrigins: [
            "*",
          ],
          maxAge: 3000,
        },
        {
          allowedHeaders: [
            "X-CRSF-Token",
          ],
          allowedMethods: [
            HttpMethods.GET,
            HttpMethods.HEAD,
          ],
          allowedOrigins: [
            "*",
          ],
        },
      ],
      serverAccessLogsBucket: props.foundationStack.logBucket,
      serverAccessLogsPrefix: 's3/data-broker/',
    })

    /* Manifest Bucket Policy */
    this.manifestBucket.addToResourcePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:GetBucketCors"],
      resources: [this.manifestBucket.bucketArn],
      principals: [new CanonicalUserPrincipal(originAccessId.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
    }),
    )

    this.manifestBucket.addToResourcePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:GetObject"],
      resources: [this.manifestBucket.bucketArn + '/*'],
      principals: [new CanonicalUserPrincipal(originAccessId.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
    }),
    )


    // Add parameter store values for later reference by other apps
    new StringParameter(this, 'sSMImageServerBaseUrl', {
      type: ParameterType.STRING,
      parameterName: `${props.appConfigPath}/image-server-base-url`,
      stringValue: StringParameter.fromStringParameterAttributes(this, 'SSMImageServerHostname', { parameterName: props.imageServerHostname }).stringValue,
      description: 'Image server base url',
    })

    new StringParameter(this, 'sSMImageSourceBucket', {
      type: ParameterType.STRING,
      parameterName: `${props.appConfigPath}/image-server-bucket`,
      stringValue: props.foundationStack.publicBucket.bucketName,
      description: 'Image source bucket',
    })

    new StringParameter(this, 'sSMManifestServerBaseUrl', {
      type: ParameterType.STRING,
      parameterName: `${props.appConfigPath}/manifest-server-base-url`,
      stringValue: props.hostnamePrefix + '.' + props.domainName,
      description: 'Manifest Server URL',
    })

    new StringParameter(this, 'sSMManifestBucket', {
      type: ParameterType.STRING,
      parameterName: `${props.appConfigPath}/manifest-server-bucket`,
      stringValue: this.manifestBucket.bucketName,
      description: 'S3 Bucket to hold Manifests',
    })

    new StringParameter(this, 'sSMProcessBucket', {
      type: ParameterType.STRING,
      parameterName: `${props.appConfigPath}/process-bucket`,
      stringValue: processBucket.bucketName,
      description: 'S3 Bucket to accumulate assets during processing',
    })

    new StringParameter(this, 'sSMRBSCS3ImageBucketName', {
      type: ParameterType.STRING,
      parameterName: `${props.appConfigPath}/rbsc-image-bucket`,
      stringValue: props.rBSCS3ImageBucketName,
      description: 'Name of the RBSC Image Bucket',
    })
    
    const sPARedirectionLambda = new Function(this, 'SPARedirectionLambda', {
      code: Code.fromInline(`'use strict';
        exports.handler = (event, context, callback) => {
          var request = event.Records[0].cf.request;

          if (!request.uri.endsWith('/index.json') && !request.uri.endsWith('.xml')) {
            if (request.uri.endsWith('/')) {
              request.uri = request.uri + 'index.json'
            } else {
              request.uri = request.uri + '/index.json'
            }
          }
          return callback(null, request);
        };`),
      handler: 'index.handler',
      runtime: Runtime.NODEJS_12_X,
      description: `This Lambda will take incoming web requests and adjust the request URI as appropriate.
        Any directory that does not end with an index.json will have that appended to it.`,
    })

    const sPARedirectionLambdaV2 = new Version(this, 'SPARedirectionLambdaV2', {
      lambda: sPARedirectionLambda,
      description: 'Adds rewrite rules as needed',
    })


    // Create a CloudFront Distribution for the manifest bucket
    const fqdn = `${props.hostnamePrefix}.${props.domainName}`
    this.distribution = new CloudFrontWebDistribution(this, 'CloudFrontWebDistribution', {
      originConfigs: [{
        s3OriginSource: {
          s3BucketSource: this.manifestBucket,
          originAccessIdentity: originAccessId,
        },
        behaviors: [{
          isDefaultBehavior: true,
          lambdaFunctionAssociations: [{
            eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
            lambdaFunction: sPARedirectionLambdaV2,
          }],
          forwardedValues: {
            queryString: false,
            headers: ["Access-Control-Request-Headers",
              "Access-Control-Request-Method",
              "Origin",
              "Authorization",
            ],
          },
          allowedMethods: CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
          compress: true,
        }],
      }],
      defaultRootObject: 'index.json',
      httpVersion: HttpVersion.HTTP2,
      loggingConfig: {
        bucket: props.foundationStack.logBucket,
        includeCookies: true,
        prefix: `web/${props.hostnamePrefix}.${props.domainName}`,
      },
      priceClass: PriceClass.PRICE_CLASS_100,
      viewerCertificate: ViewerCertificate.fromAcmCertificate(props.foundationStack.certificate, {
        aliases: [fqdn],
      }),
      comment: props.hostnamePrefix + '.' + props.domainName,
    })


    if (props.createDns) {
      new CnameRecord(this, `HostnamePrefix-Route53CnameRecord`, {
        recordName: props.hostnamePrefix,
        domainName: this.distribution.distributionDomainName,
        zone: props.foundationStack.hostedZone,
        ttl: Duration.minutes(15),
      })
    }
    
    if (!fs.existsSync(props.lambdaCodeRootPath)) {
      Annotations.of(this).addError(`Cannot deploy this stack. Asset path not found ${props.lambdaCodeRootPath}`)
      return
    }
    const initManifestLambda = new Function(this, 'InitManifestLambdaFunction', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'init/')),
      description: 'Initializes the manifest pipeline step functions',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        SSM_KEY_BASE: props.appConfigPath,
        SENTRY_DSN: props.sentryDsn,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
      ],
      timeout: Duration.seconds(90),
    })

    processBucket.grantReadWrite(initManifestLambda)
    this.manifestBucket.grantReadWrite(initManifestLambda)

    
    const processManifestLambda = new Function(this, 'ProcessManifestLambdaFunction', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'process_manifest/')),
      description: 'Creates iiif Manifests',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        SENTRY_DSN: props.sentryDsn,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
      ],
      timeout: Duration.seconds(900),
    })

    processBucket.grantReadWrite(processManifestLambda)
    this.manifestBucket.grantReadWrite(processManifestLambda)


    const finalizeManifestLambda = new Function(this, 'FinalizeManifestLambdaFunction', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'finalize/')),
      description: 'Copies Manifests and other artifacts to the process bucket',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        SENTRY_DSN: props.sentryDsn,
        PROCESS_BUCKET: processBucket.bucketArn,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ses:SendEmail"],
          resources: ["*"],
        }),
      ],
      timeout: Duration.seconds(900),
    })

    this.manifestBucket.grantReadWrite(finalizeManifestLambda)
    processBucket.grantReadWrite(finalizeManifestLambda)
    props.foundationStack.publicBucket.grantReadWrite(finalizeManifestLambda)

    
    // Create tasks for state machine
    const initManifestTask = new tasks.LambdaInvoke(this, 'InitManifestTask', {
      lambdaFunction: initManifestLambda,
      outputPath: '$.Payload', /* GOTCHA:  Lambda output is in $.Payload.  Use this to save to the root to chain to subsequent steps. */
    })

    const processManifestTask = new tasks.LambdaInvoke(this, 'ProcessManifestTask', {
      lambdaFunction: processManifestLambda,
      outputPath: '$.Payload',
    })

    const finalizeManifestTask = new tasks.LambdaInvoke(this, 'FinalizeManifestTask', {
      lambdaFunction: finalizeManifestLambda,
      outputPath: '$.Payload',
    })

    const successState = new Succeed(this, 'Succeed')
    const failureState = new Fail(this, "Fail")

    const denoteErrorChoice = new Choice(this, 'DenoteErrorChoice')
          .when(Condition.booleanEquals('$.error_found', true), failureState)
      .otherwise(successState)

    const restartFinalizeManifestChoice = (new Choice(this, 'restartFinalizeManifestChoice')
      .when(Condition.booleanEquals('$.finalize_complete', false), finalizeManifestTask)
      .when(Condition.booleanEquals('$.finalize_complete', true), denoteErrorChoice)
      .otherwise(denoteErrorChoice)
    )

    const restartProcessManifestChoice = (new Choice(this, 'RestartProcessManifestChoice')
      .when(Condition.booleanEquals('$.process_manifest_complete', false), processManifestTask)
      .when(Condition.booleanEquals('$.process_manifest_complete', true), finalizeManifestTask)
      .otherwise(finalizeManifestTask)
      )

    initManifestTask.addCatch(processManifestTask, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(processManifestTask, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(processManifestTask, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(processManifestTask)

    processManifestTask.addCatch(restartProcessManifestChoice, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(restartProcessManifestChoice, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(restartProcessManifestChoice, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(restartProcessManifestChoice)
    
    finalizeManifestTask.addCatch(restartFinalizeManifestChoice, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(restartFinalizeManifestChoice, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(restartFinalizeManifestChoice, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(restartFinalizeManifestChoice)
    
    const schemaStateMachine = new StateMachine(this, 'SchemaStateMachine', {
      definition: initManifestTask,
      logs: {
        destination: props.foundationStack.logGroup,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    })


    const museumExportLambda = new Function(this, 'MuseumExportLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'museum_export/')),
      description: 'Creates standard json from web-enabled items from Web Kiosk.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: this.filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        METADATA_TABLE_NAME: this.metadataDynamoTable.tableName,
        METADATA_TABLE_PRIMARY_KEY: 'id',
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.ssmPolicy(props.googleKeyPath),
        ManifestPipelineStack.ssmPolicy(props.museumKeyPath),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ses:SendEmail"],
          resources: ["*"],
        }),
      ],
      timeout: Duration.seconds(900),
    })

    // Grants
    this.manifestBucket.grantReadWrite(museumExportLambda)
    processBucket.grantReadWrite(museumExportLambda)
    this.filesDynamoTable.grantReadWriteData(museumExportLambda)
    this.metadataDynamoTable.grantReadWriteData(museumExportLambda)


    const alephExportLambda = new Function(this, 'AlephExportLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'aleph_export/')),
      description: 'Creates standard json from Aleph records with 500$a = MARBLE.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: this.filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        METADATA_TABLE_NAME: this.metadataDynamoTable.tableName,
        METADATA_TABLE_PRIMARY_KEY: 'id',
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.allowListBucketPolicy(props.rBSCS3ImageBucketName),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ses:SendEmail"],
          resources: ["*"],
        }),
      ],
      timeout: Duration.seconds(900),
    })

    // Grants
    this.manifestBucket.grantReadWrite(alephExportLambda)
    processBucket.grantReadWrite(alephExportLambda)
    this.filesDynamoTable.grantReadWriteData(alephExportLambda)
    this.metadataDynamoTable.grantReadWriteData(alephExportLambda)


    const curateExportLambda = new Function(this, 'CurateExportLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'curate_export/')),
      description: 'Creates standard json from a list of curate PIDs.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: this.filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        METADATA_TABLE_NAME: this.metadataDynamoTable.tableName,
        METADATA_TABLE_PRIMARY_KEY: 'id',
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.ssmPolicy(props.curateKeyPath),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ses:SendEmail"],
          resources: ["*"],
        }),
      ],
      timeout: Duration.seconds(900),
    })

    // Grants
    this.manifestBucket.grantReadWrite(curateExportLambda)
    processBucket.grantReadWrite(curateExportLambda)
    this.filesDynamoTable.grantReadWriteData(curateExportLambda)
    this.metadataDynamoTable.grantReadWriteData(curateExportLambda)
    

    const archivesSpaceExportLambda = new Function(this, 'ArchivesSpaceExportLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'archivesspace_export/')),
      description: 'Creates standard json from a list of ArchivesSpace urls.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: this.filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        METADATA_TABLE_NAME: this.metadataDynamoTable.tableName,
        METADATA_TABLE_PRIMARY_KEY: 'id',
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.allowListBucketPolicy(props.rBSCS3ImageBucketName),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ses:SendEmail"],
          resources: ["*"],
        }),
      ],
      timeout: Duration.seconds(900),
    })

    // Grants
    this.manifestBucket.grantReadWrite(archivesSpaceExportLambda)
    processBucket.grantReadWrite(archivesSpaceExportLambda)
    this.filesDynamoTable.grantReadWriteData(archivesSpaceExportLambda)
    this.metadataDynamoTable.grantReadWriteData(archivesSpaceExportLambda)


    const collectionsApiLambda = new Function(this, 'CollectionsApiLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'collections_api/')),
      description: 'Creates json representations of collections to be used by Red Box.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: this.filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        METADATA_TABLE_NAME: this.metadataDynamoTable.tableName,
        METADATA_TABLE_PRIMARY_KEY: 'id',
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["s3:ListObjects", "s3:ListBucket"],
          resources: [
            Fn.sub(`arn:aws:s3:::${props.rBSCS3ImageBucketName}`),
            Fn.sub(`arn:aws:s3:::${props.rBSCS3ImageBucketName}/*`),
          ],
        }),
      ],
      timeout: Duration.seconds(900),
    })

    // Grants
    this.manifestBucket.grantReadWrite(collectionsApiLambda)
    processBucket.grantReadWrite(collectionsApiLambda)
    this.filesDynamoTable.grantReadWriteData(collectionsApiLambda)
    this.metadataDynamoTable.grantReadWriteData(collectionsApiLambda)
    this.metadataAugmentationDynamoTable.grantReadWriteData(collectionsApiLambda)


    const objectFilesApiLambda = new Function(this, 'ObjectFilesApiLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'object_files_api/')),
      description: 'Creates json representations files to be used by Red Box.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      memorySize: 512,
      environment: {
        FILES_TABLE_NAME: this.filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        METADATA_TABLE_NAME: this.metadataDynamoTable.tableName,
        METADATA_TABLE_PRIMARY_KEY: 'id',
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.allowListBucketPolicy(props.rBSCS3ImageBucketName),
      ],
      timeout: Duration.seconds(900),
    })

    // Grants
    this.manifestBucket.grantReadWrite(objectFilesApiLambda)
    processBucket.grantReadWrite(objectFilesApiLambda)
    this.filesDynamoTable.grantReadWriteData(objectFilesApiLambda)
    this.metadataDynamoTable.grantReadWriteData(objectFilesApiLambda)
    this.metadataAugmentationDynamoTable.grantReadWriteData(objectFilesApiLambda)


    // Create tasks for harvest state machine
    // Aleph
    const alephExportTask = new tasks.LambdaInvoke(this, 'AlephExportTask', {
      lambdaFunction: alephExportLambda,
      outputPath: '$.Payload',
    })
    const alephLoopChoice = (new Choice(this, 'AlephLoopChoice', {
    })
      .when(Condition.booleanEquals('$.alephHarvestComplete', false), alephExportTask)
      .otherwise(new Succeed(this, 'AlephSucceed'))
    )
    const alephExportFailureState = new Fail(this, "AlephExportFail")
    alephExportTask
      .addCatch(alephExportFailureState, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(alephExportFailureState, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(alephExportFailureState, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(alephLoopChoice)

    // ArchivesSpace
    const archivesSpaceExportTask = new tasks.LambdaInvoke(this, 'ArchivesSpaceExportTask', {
      lambdaFunction: archivesSpaceExportLambda,
      outputPath: '$.Payload', /* GOTCHA:  Lambda output is in $.Payload.  Use this to save to the root to chain to subsequent steps. */
    })
    const archivesSpaceLoopChoice = (new Choice(this, 'ArchivesSpaceLoopChoice', {
    })
      .when(Condition.booleanEquals('$.archivesSpaceHarvestComplete', false), archivesSpaceExportTask)
      .otherwise(new Succeed(this, 'ArhcivesSpaceSucceed'))
    )
    const archivesSpaceExportFailureState = new Fail(this, "ArchivesSpaceExportFail")
    archivesSpaceExportTask
      .addCatch(archivesSpaceExportFailureState, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(archivesSpaceExportFailureState, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(archivesSpaceExportFailureState, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(archivesSpaceLoopChoice)

    // CollectionsApi
    const collectionsApiTask = new tasks.LambdaInvoke(this, 'CollectionsApiTask', {
      lambdaFunction: collectionsApiLambda,
      outputPath: '$.Payload',
    })
    const collectionsApiLoopChoice = (new Choice(this, 'CollectionsApiLoopChoice', {
    })
      .when(Condition.booleanEquals('$.collectionsApiComplete', false), collectionsApiTask)
      .otherwise(new Succeed(this, 'CollectionsApiSucceed'))
    )
    const collectionsFailureState = new Fail(this, "CollectionsFail")
    collectionsApiTask
      .addCatch(collectionsFailureState, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(collectionsFailureState, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(collectionsFailureState, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(collectionsApiLoopChoice)

    // Curate
    const curateExportTask = new tasks.LambdaInvoke(this, 'CurateExportTask', {
      lambdaFunction: curateExportLambda,
      outputPath: '$.Payload',
    })
    const curateLoopChoice = (new Choice(this, 'CurateLoopChoice', {
    })
      .when(Condition.booleanEquals('$.curateHarvestComplete', false), curateExportTask)
      .otherwise(new Succeed(this, 'CurateSucceed'))
    )
    const curateExportFailureState = new Fail(this, "CurateExportFail")
    curateExportTask
      .addCatch(curateExportFailureState, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(curateExportFailureState, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(curateExportFailureState, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(curateLoopChoice)


    // Museum
    const museumExportTask = new tasks.LambdaInvoke(this, 'MuseumExportTask', {
      lambdaFunction: museumExportLambda,
      outputPath: '$.Payload',
    })
    const museumLoopChoice = (new Choice(this, 'MuseumLoopChoice', {
    })
      .when(Condition.booleanEquals('$.museumHarvestComplete', false), museumExportTask)
      .otherwise(new Succeed(this, 'MuseumSucceed'))
    )
    const museumExportFailureState = new Fail(this, "MuseumExportFail")
    museumExportTask
      .addCatch(museumExportFailureState, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(museumExportFailureState, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(museumExportFailureState, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(museumLoopChoice)

    // ObjectFilesApi
    const objectFilesApiTask = new tasks.LambdaInvoke(this, 'ObjectFilesApiTask', {
      lambdaFunction: objectFilesApiLambda,
      outputPath: '$.Payload',
    })
    const objectFilesApiLoopChoice = (new Choice(this, 'objectFilesApiLoopChoice', {
    })
      .when(Condition.booleanEquals('$.objectFilesApiComplete', false), objectFilesApiTask)
      .otherwise(new Succeed(this, 'ObjectFilesSucceed'))
    )
    const objectFilesApiFailureState = new Fail(this, "ObjectFilesApiFail")
    objectFilesApiTask
      .addCatch(objectFilesApiFailureState, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(objectFilesApiFailureState, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(objectFilesApiFailureState, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(objectFilesApiLoopChoice)

    const passDictEventTask = new Pass(this, "PassDictEventTask", {
      comment: 'Added to discard list event created by execution of parallel branches and pass along a dict event for subsequent steps.',
      inputPath: JsonPath.DISCARD,
      result: Result.fromObject({ passTaskComplete: true }),
    })

    // Define parallel exectution
    const parallelSteps = new Parallel(this, 'ParallelSteps')
    // // branches to be executed in parallel
    parallelSteps.branch(alephExportTask)
    parallelSteps.branch(archivesSpaceExportTask)
    parallelSteps.branch(curateExportTask)
    parallelSteps.branch(museumExportTask)
    parallelSteps.branch(objectFilesApiTask)
    // Catch errors
    parallelSteps.addCatch(passDictEventTask, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
    parallelSteps.addCatch(passDictEventTask, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
    parallelSteps.addCatch(passDictEventTask, { errors: [Errors.ALL], resultPath: '$.unexpected' })
    // Continue after all previous steps have completed
    parallelSteps.next(passDictEventTask)
      .next(collectionsApiTask)


    const harvestStateMachine = new StateMachine(this, 'HarvestStateMachine', {
      definition: parallelSteps,
      logs: {
        destination: props.foundationStack.logGroup,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    })

    new StringParameter(this, 'ObjectFilesTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/files-tablename`,
      stringValue: this.filesDynamoTable.tableName,
    })

    if (props.createEventRules) {
      new Rule(this, 'StartStdJsonHarvestRule', {
        schedule: Schedule.cron({ minute: '0', hour: '6' }),
        targets: [new SfnStateMachine(harvestStateMachine)],
        description: 'Start State Machine harvest of source systems to create standard json.',
      })


      new Rule(this, 'StartManifestPipelineRule', {
        schedule: Schedule.cron({ minute: '0', hour: '8' }),
        targets: [new SfnStateMachine(schemaStateMachine)],
        description: 'Start State Machine to create manifests.',
      })
    }

  }
}
