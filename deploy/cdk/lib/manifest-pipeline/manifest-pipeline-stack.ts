import { CloudFrontWebDistribution, OriginAccessIdentity } from '@aws-cdk/aws-cloudfront'
import { SfnStateMachine } from "@aws-cdk/aws-events-targets"
import { CanonicalUserPrincipal, Effect, PolicyStatement } from '@aws-cdk/aws-iam'
import { Function, Runtime } from "@aws-cdk/aws-lambda"
import { Bucket, HttpMethods, IBucket } from "@aws-cdk/aws-s3"
import { ParameterType, StringParameter } from '@aws-cdk/aws-ssm'
import { Choice, Condition, Errors, Fail, JsonPath, LogLevel, Parallel, Pass, Result, StateMachine, Succeed } from '@aws-cdk/aws-stepfunctions'
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks'
import { Construct, Duration, Fn, Stack, StackProps, CfnOutput, Annotations } from "@aws-cdk/core"
import path = require('path')
import { FoundationStack } from '../foundation'
import { Rule, Schedule } from "@aws-cdk/aws-events"
import dynamodb = require('@aws-cdk/aws-dynamodb')
import backup = require('@aws-cdk/aws-backup')
import { AssetHelpers } from '../asset-helpers'
import { S3NotificationToLambdaCustomResource } from './s3ToLambda'

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
   * The name of the bucket that contains marble content
   */
  readonly marbleContentBucketName: string;

  /**
   * S3 bucket where multimedia assets are stored (created by multimedia-assets stack)
   */
  readonly multimediaBucket: Bucket;

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

  /**
   * This will create the CopyMediaContentLambda if true, otherwise it won't.
   */
  readonly createCopyMediaContentLambda?: boolean;

  /**
   * The fileShareId for the Marble Content Storage Gateway.  This will be used to create the File Share ARN to pass to the CopyMediaLambda
   */
  readonly marbleContentFileShareId: string;

  /**
   * The flag to determine if we a backup should be added to the dynamo table.
   */
  readonly createBackup?: string;


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
        `arn:aws:s3:::${bucketName}`,
        `arn:aws:s3:::${bucketName}/*`,
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

  /** The DynamoDB table to hold all WebsiteMetadata for MARBLE content and all related websites.
   * This will be used by Red Box to maintain supplimentary metadata and will also be used as a source to build MARBLE and related websites.
  */
  public readonly websiteMetadataDynamoTable: dynamodb.Table


  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props)


    if (props.hostnamePrefix.length > 63) {
      Annotations.of(this).addError(`Max length of hostnamePrefix is 63.  "${props.hostnamePrefix}" is too long.}`)
    }

    if (!RegExp('^$|(?!-)[a-zA-Z0-9-.]{1,63}(?<!-)').test(props.hostnamePrefix)) {
      Annotations.of(this).addError(`hostnamePrefix does not match legal pattern.`)
    }

    // Create Dynamo Tables
    this.websiteMetadataDynamoTable = new dynamodb.Table(this, 'websiteMetadata', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expireTime',
    })
    this.websiteMetadataDynamoTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'GSI1PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI1SK',
        type: dynamodb.AttributeType.STRING,
      },
    })
    this.websiteMetadataDynamoTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: {
        name: 'GSI2PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI2SK',
        type: dynamodb.AttributeType.STRING,
      },
    })
    this.websiteMetadataDynamoTable.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: {
        name: 'GSI3PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI3SK',
        type: dynamodb.AttributeType.STRING,
      },
    })
    new StringParameter(this, 'WebsiteMetadataTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/website-metadata-tablename`,
      stringValue: this.websiteMetadataDynamoTable.tableName,
    })
    new StringParameter(this, 'WebsiteMetadataTTLDaysParam', {
      type: ParameterType.STRING,
      parameterName: `/all/stacks/${this.stackName}/website-metadata-time-to-live-days`,
      stringValue: props.metadataTimeToLiveDays,
      description: 'Time To live for metadata dynamodb records',
    })

    // currently we only want this to be added in the stage production.
    if (props.createBackup === "true") {
      const plan = backup.BackupPlan.dailyMonthly1YearRetention(this, 'MarbleDynamoDbBackupPlan')
      plan.addSelection('DynamoTables', {
        resources: [
          backup.BackupResource.fromDynamoDbTable(this.websiteMetadataDynamoTable), // A DynamoDB table
        ]
      })
      plan.addRule(backup.BackupPlanRule.daily())
    }

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

    new StringParameter(this, 'sSMMarbleContentBucketName', {
      type: ParameterType.STRING,
      parameterName: `${props.appConfigPath}/marble-content-bucket`,
      stringValue: props.marbleContentBucketName,
      description: 'Name of the Bucket containing marble content',
    })

    new StringParameter(this, 'sSMMultimediaBucketName', {
      type: ParameterType.STRING,
      parameterName: `${props.appConfigPath}/multimedia-bucket`,
      stringValue: props.multimediaBucket.bucketName,
      description: 'Name of the Multimedia Assets Bucket',
    })

    if ((props.createCopyMediaContentLambda !== undefined) && props.createCopyMediaContentLambda) {

      const marbleContentBucket = Bucket.fromBucketName(this, 'MarbleContentBucket', props.marbleContentBucketName)
      const fileShareArn = Fn.sub('arn:aws:storagegateway:${AWS::Region}:${AWS::AccountId}:share/') + props.marbleContentFileShareId
      const copyMediaContentLambda = new Function(this, 'CopyMediaContentLambda', {
        code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'copy_media_content/')),
        description: 'Copies media files from other folders to /public-access/media folder to be served by CDN',
        handler: 'handler.run',
        runtime: Runtime.PYTHON_3_8,
        environment: {
          SENTRY_DSN: props.sentryDsn,
          FILE_SHARE_ARN: fileShareArn,
        },
        timeout: Duration.seconds(900),
        initialPolicy: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["storagegateway:RefreshCache"],
            resources: [fileShareArn],
          }),
        ],
      })

      // Grants
      marbleContentBucket.grantReadWrite(copyMediaContentLambda)

      // Attach s3 event to lambda  (but we can't do it directly using the Function.event construct because of https://github.com/aws/aws-cdk/issues/2004)
      new S3NotificationToLambdaCustomResource(this, id, marbleContentBucket, copyMediaContentLambda)

    }

    const museumExportLambda = new Function(this, 'MuseumExportLambda', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'museum_export/')),
      description: 'Creates standard json from web-enabled items from Web Kiosk.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        WEBSITE_METADATA_TABLE_Name: this.websiteMetadataDynamoTable.tableName,
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
    this.websiteMetadataDynamoTable.grantReadWriteData(museumExportLambda)

    const alephExportLambda = new Function(this, 'AlephExportLambda', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'aleph_export/')),
      description: 'Creates standard json from Aleph records with 500$a = MARBLE.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        WEBSITE_METADATA_TABLE_Name: this.websiteMetadataDynamoTable.tableName,
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.allowListBucketPolicy(props.rBSCS3ImageBucketName),
        ManifestPipelineStack.allowListBucketPolicy(props.marbleContentBucketName),
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
    this.websiteMetadataDynamoTable.grantReadWriteData(alephExportLambda)


    const curateExportLambda = new Function(this, 'CurateExportLambda', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'curate_export/')),
      description: 'Creates standard json from a list of curate PIDs.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        WEBSITE_METADATA_TABLE_Name: this.websiteMetadataDynamoTable.tableName,
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
      memorySize: 512,
    })

    // Grants
    this.manifestBucket.grantReadWrite(curateExportLambda)
    processBucket.grantReadWrite(curateExportLambda)
    this.websiteMetadataDynamoTable.grantReadWriteData(curateExportLambda)


    const archivesSpaceExportLambda = new Function(this, 'ArchivesSpaceExportLambda', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'archivesspace_export/')),
      description: 'Creates standard json from a list of ArchivesSpace urls.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        WEBSITE_METADATA_TABLE_Name: this.websiteMetadataDynamoTable.tableName,
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.allowListBucketPolicy(props.rBSCS3ImageBucketName),
        ManifestPipelineStack.allowListBucketPolicy(props.marbleContentBucketName),
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
    this.websiteMetadataDynamoTable.grantReadWriteData(archivesSpaceExportLambda)


    const objectFilesApiLambda = new Function(this, 'ObjectFilesApiLambda', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'object_files_api/')),
      description: 'Creates json representations files to be used by Red Box.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      memorySize: 512,
      environment: {
        WEBSITE_METADATA_TABLE_Name: this.websiteMetadataDynamoTable.tableName,
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.allowListBucketPolicy(props.rBSCS3ImageBucketName),
        ManifestPipelineStack.allowListBucketPolicy(props.marbleContentBucketName),
        ManifestPipelineStack.allowListBucketPolicy(props.multimediaBucket.bucketName),
      ],
      timeout: Duration.seconds(900),
    })

    // Grants
    this.manifestBucket.grantReadWrite(objectFilesApiLambda)
    processBucket.grantReadWrite(objectFilesApiLambda)
    this.websiteMetadataDynamoTable.grantReadWriteData(objectFilesApiLambda)


    const expandSubjectTermsLambda = new Function(this, 'ExpandSubjectTermsLambda', {
      code: AssetHelpers.codeFromAsset(this, path.join(props.lambdaCodeRootPath, 'expand_subject_terms_lambda/')),
      description: 'Cycles through subject term URIs stored in dynamo, and expands those subject terms using the appropriate online authority.',
      handler: 'handler.run',
      runtime: Runtime.PYTHON_3_8,
      memorySize: 512,
      environment: {
        WEBSITE_METADATA_TABLE_Name: this.websiteMetadataDynamoTable.tableName,
        SENTRY_DSN: props.sentryDsn,
        SSM_KEY_BASE: props.appConfigPath,
      },
      initialPolicy: [
        ManifestPipelineStack.ssmPolicy(props.appConfigPath),
        ManifestPipelineStack.ssmPolicy(props.marbleProcessingKeyPath),
        ManifestPipelineStack.allowListBucketPolicy(props.rBSCS3ImageBucketName),
        ManifestPipelineStack.allowListBucketPolicy(props.marbleContentBucketName),
      ],
      timeout: Duration.seconds(900),
    })

    // Grants
    this.websiteMetadataDynamoTable.grantReadWriteData(expandSubjectTermsLambda)


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

    // Expand Subject Terms
    const expandSubjectTermsTask = new tasks.LambdaInvoke(this, 'ExpandSubjectTermsTask', {
      lambdaFunction: expandSubjectTermsLambda,
      outputPath: '$.Payload',
    })
    const expandSubjectTermsLoopChoice = (new Choice(this, 'ExpandSubjectTermsLoopChoice', {
    })
      .when(Condition.booleanEquals('$.expandSubjectTermsComplete', false), expandSubjectTermsTask)
      .otherwise(new Succeed(this, 'ExpandSubjectTermsSucceed'))
    )
    const expandSubjectTermsFailureState = new Fail(this, "ExpandSubjectTermsFail")
    expandSubjectTermsTask
      .addCatch(expandSubjectTermsFailureState, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
      .addCatch(expandSubjectTermsFailureState, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
      .addCatch(expandSubjectTermsFailureState, { errors: [Errors.ALL], resultPath: '$.unexpected' })
      .next(expandSubjectTermsLoopChoice)

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
    parallelSteps.branch(expandSubjectTermsTask)
    parallelSteps.branch(museumExportTask)
    parallelSteps.branch(objectFilesApiTask)
    // Catch errors
    parallelSteps.addCatch(passDictEventTask, { errors: ['Lambda.Unknown'], resultPath: '$.unexpected' })
    parallelSteps.addCatch(passDictEventTask, { errors: [Errors.TASKS_FAILED], resultPath: '$.unexpected' })
    parallelSteps.addCatch(passDictEventTask, { errors: [Errors.ALL], resultPath: '$.unexpected' })
    // Continue after all previous steps have completed
    parallelSteps.next(passDictEventTask)
      .next(new Succeed(this, 'HarvestSucceed'))


    const harvestStateMachine = new StateMachine(this, `${this.stackName}-HarvestStateMachine`, {
      definition: parallelSteps,
      logs: {
        destination: props.foundationStack.logGroup,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    })

    if (props.createEventRules) {
      new Rule(this, 'StartStdJsonHarvestRule', {
        schedule: Schedule.cron({ minute: '0', hour: '6' }),
        targets: [new SfnStateMachine(harvestStateMachine)],
        description: 'Start State Machine harvest of source systems to create standard json.',
      })
    }

  }
}
