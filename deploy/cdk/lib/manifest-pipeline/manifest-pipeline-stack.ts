import { CloudFrontAllowedMethods, CloudFrontWebDistribution, HttpVersion, LambdaEdgeEventType, OriginAccessIdentity, PriceClass, ViewerCertificate } from '@aws-cdk/aws-cloudfront'
import { SfnStateMachine } from "@aws-cdk/aws-events-targets"
import { CanonicalUserPrincipal, Effect, PolicyStatement } from '@aws-cdk/aws-iam'
import { Code, Function, Runtime, Version } from "@aws-cdk/aws-lambda"
import { CnameRecord } from "@aws-cdk/aws-route53"
import { Bucket, HttpMethods, IBucket } from "@aws-cdk/aws-s3"
import { ParameterType, StringParameter } from '@aws-cdk/aws-ssm'
import { Choice, Condition, Errors, Fail, LogLevel, StateMachine, Succeed } from '@aws-cdk/aws-stepfunctions'
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

  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props)

    if (props.hostnamePrefix.length > 63) {
      Annotations.of(this).addError(`Max length of hostnamePrefix is 63.  "${props.hostnamePrefix}" is too long.}`)
    }
    
    if (!RegExp('^$|(?!-)[a-zA-Z0-9-.]{1,63}(?<!-)').test(props.hostnamePrefix)) {
      Annotations.of(this).addError(`hostnamePrefix does not match legal pattern.`)
    }

    // Create Dynamo Tables
    const filesDynamoTable = new dynamodb.Table(this, 'files', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      pointInTimeRecovery: true,
    })

    const standardJsonDynamoTable = new dynamodb.Table(this, 'standardJson', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      pointInTimeRecovery: true,
    })

    const dataExtensionsDynamoTable = new dynamodb.Table(this, 'dataExtensions', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      pointInTimeRecovery: true,
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
        FILES_TABLE_NAME: filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        STANDARD_JSON_TABLE_NAME: standardJsonDynamoTable.tableName,
        STANDARD_JSON_TABLE_PRIMARY_KEY: 'id',
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
    filesDynamoTable.grantReadWriteData(museumExportLambda)
    standardJsonDynamoTable.grantReadWriteData(museumExportLambda)


    const alephExportLambda = new Function(this, 'AlephExportLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'aleph_export/')),
      description: 'Creates standard json from Aleph records with 500$a = MARBLE.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        STANDARD_JSON_TABLE_NAME: standardJsonDynamoTable.tableName,
        STANDARD_JSON_TABLE_PRIMARY_KEY: 'id',
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
    filesDynamoTable.grantReadWriteData(alephExportLambda)
    standardJsonDynamoTable.grantReadWriteData(alephExportLambda)


    const curateExportLambda = new Function(this, 'CurateExportLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'curate_export/')),
      description: 'Creates standard json from a list of curate PIDs.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        STANDARD_JSON_TABLE_NAME: standardJsonDynamoTable.tableName,
        STANDARD_JSON_TABLE_PRIMARY_KEY: 'id',
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
    filesDynamoTable.grantReadWriteData(curateExportLambda)
    standardJsonDynamoTable.grantReadWriteData(curateExportLambda)


    const archivesSpaceExportLambda = new Function(this, 'ArchivesSpaceExportLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'archivesspace_export/')),
      description: 'Creates standard json from a list of ArchivesSpace urls.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        STANDARD_JSON_TABLE_NAME: standardJsonDynamoTable.tableName,
        STANDARD_JSON_TABLE_PRIMARY_KEY: 'id',
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
    filesDynamoTable.grantReadWriteData(archivesSpaceExportLambda)
    standardJsonDynamoTable.grantReadWriteData(archivesSpaceExportLambda)


    const collectionsApiLambda = new Function(this, 'CollectionsApiLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'collections_api/')),
      description: 'Creates json representations of collections to be used by Red Box.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        FILES_TABLE_NAME: filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        STANDARD_JSON_TABLE_NAME: standardJsonDynamoTable.tableName,
        STANDARD_JSON_TABLE_PRIMARY_KEY: 'id',
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
    filesDynamoTable.grantReadWriteData(collectionsApiLambda)
    standardJsonDynamoTable.grantReadWriteData(collectionsApiLambda)
    dataExtensionsDynamoTable.grantReadWriteData(collectionsApiLambda)

    const objectFilesApiLambda = new Function(this, 'ObjectFilesApiLambda', {
      code: Code.fromAsset(path.join(props.lambdaCodeRootPath, 'object_files_api/')),
      description: 'Creates json representations files to be used by Red Box.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      memorySize: 512,
      environment: {
        FILES_TABLE_NAME: filesDynamoTable.tableName,
        FILES_TABLE_PRIMARY_KEY: 'id',
        STANDARD_JSON_TABLE_NAME: standardJsonDynamoTable.tableName,
        STANDARD_JSON_TABLE_PRIMARY_KEY: 'id',
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
    filesDynamoTable.grantReadWriteData(objectFilesApiLambda)
    standardJsonDynamoTable.grantReadWriteData(objectFilesApiLambda)
    dataExtensionsDynamoTable.grantReadWriteData(objectFilesApiLambda)

    // Create tasks for harvest state machine
    const archivesSpaceExportTask = new tasks.LambdaInvoke(this, 'ArchivesSpaceExportTask', {
      lambdaFunction: archivesSpaceExportLambda,
      outputPath: '$.Payload', /* GOTCHA:  Lambda output is in $.Payload.  Use this to save to the root to chain to subsequent steps. */
    })

    
    const museumExportTask = new tasks.LambdaInvoke(this, 'MuseumExportTask', {
      lambdaFunction: museumExportLambda,
      outputPath: '$.Payload',
    })

    const alephExportTask = new tasks.LambdaInvoke(this, 'AlephExportTask', {
      lambdaFunction: alephExportLambda,
      outputPath: '$.Payload',
    })

    const curateExportTask = new tasks.LambdaInvoke(this, 'CurateExportTask', {
      lambdaFunction: curateExportLambda,
      outputPath: '$.Payload',
    })

    const collectionsApiTask = new tasks.LambdaInvoke(this, 'CollectionsApiTask', {
      lambdaFunction: collectionsApiLambda,
      outputPath: '$.Payload',
    })

    const objectFilesApiTask = new tasks.LambdaInvoke(this, 'ObjectFilesApiTask', {
      lambdaFunction: objectFilesApiLambda,
      outputPath: '$.Payload',
    })

    const harvestSuccessState = new Succeed(this, 'HarvestSucceed')
    const harvestFailureState = new Fail(this, "HarvestFail")

    const archivesSpaceLoopChoice = (new Choice(this, 'ArchivesSpaceLoopChoice', {
    })
      .when(Condition.booleanEquals('$.archivesSpaceHarvestComplete', false), archivesSpaceExportTask)
      .when(Condition.booleanEquals('$.archivesSpaceHarvestComplete', true), museumExportTask)
      .otherwise(museumExportTask)
    )

    const museumLoopChoice = (new Choice(this, 'MuseumLoopChoice', {
    })
      .when(Condition.booleanEquals('$.museumHarvestComplete', false), museumExportTask)
      .when(Condition.booleanEquals('$.museumHarvestComplete', true), alephExportTask)
      .otherwise(alephExportTask)
    )

    const curateLoopChoice = (new Choice(this, 'CurateLoopChoice', {
    })
      .when(Condition.booleanEquals('$.curateHarvestComplete', false), curateExportTask)
      .when(Condition.booleanEquals('$.curateHarvestComplete', true), collectionsApiTask)
      .otherwise(collectionsApiTask)
    )

    archivesSpaceExportTask.addCatch(museumExportTask, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(museumExportTask, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(museumExportTask, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(archivesSpaceLoopChoice)
    
    museumExportTask.addCatch(alephExportTask, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(alephExportTask, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(alephExportTask, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(museumLoopChoice)
    
    alephExportTask.addCatch(curateExportTask, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(curateExportTask, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(curateExportTask, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(curateExportTask)
    
    curateExportTask.addCatch(collectionsApiTask, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(collectionsApiTask, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(collectionsApiTask, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(curateLoopChoice)
    
    collectionsApiTask.addCatch(objectFilesApiTask, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(objectFilesApiTask, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(objectFilesApiTask, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(objectFilesApiTask)
    
    objectFilesApiTask.addCatch(harvestFailureState, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(harvestFailureState, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(harvestFailureState, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(harvestSuccessState)

    const harvestStateMachine = new StateMachine(this, 'HarvestStateMachine', {
      definition: archivesSpaceExportTask,
      logs: {
        destination: props.foundationStack.logGroup,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    })

    new StringParameter(this, 'StandardJsonTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/standard-json-tablename`,
      stringValue: standardJsonDynamoTable.tableName,
    })

    new StringParameter(this, 'ObjectFilesTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/files-tablename`,
      stringValue: filesDynamoTable.tableName,
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
