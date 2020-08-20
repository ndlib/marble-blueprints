import { expect as expectCDK, haveResourceLike } from '@aws-cdk/assert'
import cdk = require('@aws-cdk/core')
import { FoundationStack } from '../../lib/foundation'
import { ManifestPipelineStack } from '../../lib/manifest-pipeline'


const domainName = 'test.edu'
const namespace = 'marble'
const sentryDsn = 'https://136d489c91484b55be18e0a28d463b43@sentry.io/1831199'
const rBSCS3ImageBucketName = 'libnd-smb-rbsc'


const manifestPipelineContext = {
  imageServerHostname: "/all/stacks/marble-image-service/hostname" as 'AWS::SSM::Parameter::Value<String>',
  marbleProcessingKeyPath: "/all/marble-data-processing/prod",
  noReplyEmailAddr: "noreply@nd.edu",
  googleKeyPath: "/all/marble/google",
  museumKeyPath: "/all/marble/museum",
  curateKeyPath: "/all/marble/curate",
  createEventRules: false,
  createDns: false,
  lambdaCodeRootPath: '../../../marble-manifest-pipeline/',
  hostnamePrefix: 'presentation-iiif',
  domainName,
  sentryDsn,
  rBSCS3ImageBucketName,
  appConfigPath: "/all/test-marble",
}

describe('ManifestPipelineStack', () => {
  describe('Buckets', () => {
    test('creates a Process Bucket', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::S3::Bucket', {
        LoggingConfiguration: {
          DestinationBucketName: {
            "Fn::ImportValue": "marble-foundation:ExportsOutputRefLogBucketCC3B17E818DCEC53",
          },
          LogFilePrefix: "s3/data-broker/",
        },
      }))
    })

    test('creates a Manifest Bucket', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::S3::Bucket', {
        CorsConfiguration: {
          CorsRules: [
            {
              AllowedHeaders: ["Authorization"],
              AllowedMethods: ["GET"],
              AllowedOrigins: ["*"],
              MaxAge: 3000,
            },
            {
              AllowedHeaders: ["X-CRSF-Token"],
              AllowedMethods: ["GET", "HEAD"],
              AllowedOrigins: ["*"],
            },
          ],
        },
        LoggingConfiguration: {
          DestinationBucketName: {
            "Fn::ImportValue": "marble-foundation:ExportsOutputRefLogBucketCC3B17E818DCEC53",
          },
          LogFilePrefix: "s3/data-broker/",
        },
      }))
    })
  }) /* end of describe Buckets */

  describe('SSM Parameters', () => {
    test('creates SSMImageServerBaseUrl', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::SSM::Parameter', {
        Type: "String",
        Value: {
          Ref: "SSMImageServerHostnameParameter",
        },
        Description: "Image server base url",
        Name: `${manifestPipelineContext.appConfigPath}/image-server-base-url`,
      }))
    })

    test('creates SSMImageSourceBucket', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::SSM::Parameter', {
        Type: "String",
        Value: {
          "Fn::ImportValue": "marble-foundation:ExportsOutputRefPublicBucketA6745C1519F3350E",
        },
        Description: "Image source bucket",
        Name: `${manifestPipelineContext.appConfigPath}/image-server-bucket`,
      }))
    })

    test('creates SSMManifestServerBaseUrl', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::SSM::Parameter', {
        Type: "String",
        Value: "presentation-iiif.test.edu",
        Description: "Manifest Server URL",
        Name: `${manifestPipelineContext.appConfigPath}/manifest-server-base-url`,
      }))
    })

    test('creates SSMManifestBucket', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::SSM::Parameter', {
        Type: "String",
        Value: {
          Ref: "ManifestBucket46C412A5",
        },
        Description: "S3 Bucket to hold Manifests",
        Name: `${manifestPipelineContext.appConfigPath}/manifest-server-bucket`,
      }))
    })

    test('creates SSMProcessBucket', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::SSM::Parameter', {
        Type: "String",
        Value: {
          Ref: "ProcessBucketE5460FC2",
        },
        Description: "S3 Bucket to accumulate assets during processing",
        Name: `${manifestPipelineContext.appConfigPath}/process-bucket`,
      }))
    })

    test('creates SSMRBSCS3ImageBucketName', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::SSM::Parameter', {
        Type: "String",
        Value: "libnd-smb-rbsc",
        Description: "Name of the RBSC Image Bucket",
        Name: `${ manifestPipelineContext.appConfigPath }/rbsc-image-bucket`,
      }))
    })
  }) /* end of describe SSM Parameters */


  describe('Edge Lambda', () => {
    test('creates a Service Roll for the Edge Lambda ', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              "Action": "sts:AssumeRole",
              "Effect": "Allow",
              "Principal": {
                "Service": "lambda.amazonaws.com",
              },
            },
          ],
        },
      }))
    })

  }) /* end of describe Lambdas */


  describe('Lambdas', () => {
    test('creates an SPA Redirection Edge Lambda ', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Handler: "index.handler",
        Description: `This Lambda will take incoming web requests and adjust the request URI as appropriate.
        Any directory that does not end with an index.json will have that appended to it.`,
      }))
    })

    test('creates InitManifestLambdaFunction', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Initializes the manifest pipeline step functions',
        Role: {
          "Fn::GetAtt": [
            "InitManifestLambdaFunctionServiceRole2C465585",
            "Arn",
          ],
        },
      }))
    })

    test('creates ProcessManifestLambdaFunction', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Creates iiif Manifests',
        Role: {
          "Fn::GetAtt": [
            "ProcessManifestLambdaFunctionServiceRoleEE75A7D5",
            "Arn",
          ],
        },
      }))
    })

    test('creates FinalizeManifestLambdaFunction', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Copies Manifests and other artifacts to the process bucket',
        Role: {
          "Fn::GetAtt": [
            "FinalizeManifestLambdaFunctionServiceRole4C013470",
            "Arn",
          ],
        },
      }))
    })

    test('creates MuseumExportLambda', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Creates standard json from web-enabled items from Web Kiosk.',
        Role: {
          "Fn::GetAtt": [
            "MuseumExportLambdaServiceRoleA972C11B",
            "Arn",
          ],
        },
      }))
    })

    test('creates AlephExportLambda', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Creates standard json from Aleph records with 500$a = MARBLE.',
        Role: {
          "Fn::GetAtt": [
            "AlephExportLambdaServiceRoleFD64626C",
            "Arn",
          ],
        },
      }))
    })

    test('creates ArchivesSpaceExportLambda', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Creates standard json from a list of ArchivesSpace urls.',
        Role: {
          "Fn::GetAtt": [
            "ArchivesSpaceExportLambdaServiceRole15D7EF45",
            "Arn",
          ],
        },
      }))
    })

    test('creates CurateExportLambda', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Creates standard json from a list of curate PIDs.',
        Role: {
          "Fn::GetAtt": [
            "CurateExportLambdaServiceRoleEFD480E8",
            "Arn",
          ],
        },
      }))
    })

    test('creates CollectionsApiLambda', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Creates json representations of collections to be used by Red Box.',
        Role: {
          "Fn::GetAtt": [
            "CollectionsApiLambdaServiceRoleA17A992D",
            "Arn",
          ],
        },
      }))
    })

    test('creates ObjectFilesApiLambda', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: 'Creates json representations files to be used by Red Box.',
        Role: {
          "Fn::GetAtt": [
            "ObjectFilesApiLambdaServiceRoleD6E8D461",
            "Arn",
          ],
        },
      }))
    })


  }) /* end of describe Lambdas */



  describe('State Machines', () => {
    test('creates SchemaStateMachine ', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::StepFunctions::StateMachine', {
        "DefinitionString": {
          "Fn::Join": [
            "",
            [
              "{\"StartAt\":\"InitManifestTask\",\"States\":{\"InitManifestTask\":{\"Next\":\"ProcessManifestTask\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"ProcessManifestTask\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"ProcessManifestTask\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"ProcessManifestTask\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "InitManifestLambdaFunctionF2D2228A",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"ProcessManifestTask\":{\"Next\":\"RestartProcessManifestChoice\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"RestartProcessManifestChoice\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"RestartProcessManifestChoice\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"RestartProcessManifestChoice\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "ProcessManifestLambdaFunction1C2E58FB",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"RestartProcessManifestChoice\":{\"Type\":\"Choice\",\"Choices\":[{\"Variable\":\"$.process_manifest_complete\",\"BooleanEquals\":false,\"Next\":\"ProcessManifestTask\"},{\"Variable\":\"$.process_manifest_complete\",\"BooleanEquals\":true,\"Next\":\"FinalizeManifestTask\"}],\"Default\":\"FinalizeManifestTask\"},\"FinalizeManifestTask\":{\"Next\":\"restartFinalizeManifestChoice\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"restartFinalizeManifestChoice\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"restartFinalizeManifestChoice\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"restartFinalizeManifestChoice\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "FinalizeManifestLambdaFunction5590627E",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"restartFinalizeManifestChoice\":{\"Type\":\"Choice\",\"Choices\":[{\"Variable\":\"$.finalize_complete\",\"BooleanEquals\":false,\"Next\":\"FinalizeManifestTask\"},{\"Variable\":\"$.finalize_complete\",\"BooleanEquals\":true,\"Next\":\"DenoteErrorChoice\"}],\"Default\":\"DenoteErrorChoice\"},\"DenoteErrorChoice\":{\"Type\":\"Choice\",\"Choices\":[{\"Variable\":\"$.error_found\",\"BooleanEquals\":true,\"Next\":\"Fail\"}],\"Default\":\"Succeed\"},\"Succeed\":{\"Type\":\"Succeed\"},\"Fail\":{\"Type\":\"Fail\"}}}",
            ],
          ],
        },
      }))
    })

    test('creates HarvestStateMachine ', () => {
      const app = new cdk.App()

      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })

      // WHEN
      const stack = new ManifestPipelineStack(app, 'MyTestStack', {
        foundationStack,
        ...manifestPipelineContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::StepFunctions::StateMachine', {
        DefinitionString: {
          "Fn::Join": [
            "",
            [
              "{\"StartAt\":\"ArchivesSpaceExportTask\",\"States\":{\"ArchivesSpaceExportTask\":{\"Next\":\"ArchivesSpaceLoopChoice\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"MuseumExportTask\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"MuseumExportTask\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"MuseumExportTask\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "ArchivesSpaceExportLambda65D45E42",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"ArchivesSpaceLoopChoice\":{\"Type\":\"Choice\",\"Choices\":[{\"Variable\":\"$.archivesSpaceHarvestComplete\",\"BooleanEquals\":false,\"Next\":\"ArchivesSpaceExportTask\"},{\"Variable\":\"$.archivesSpaceHarvestComplete\",\"BooleanEquals\":true,\"Next\":\"MuseumExportTask\"}],\"Default\":\"MuseumExportTask\"},\"MuseumExportTask\":{\"Next\":\"MuseumLoopChoice\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"AlephExportTask\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"AlephExportTask\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"AlephExportTask\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "MuseumExportLambda9BC1818C",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"MuseumLoopChoice\":{\"Type\":\"Choice\",\"Choices\":[{\"Variable\":\"$.museumHarvestComplete\",\"BooleanEquals\":false,\"Next\":\"MuseumExportTask\"},{\"Variable\":\"$.museumHarvestComplete\",\"BooleanEquals\":true,\"Next\":\"AlephExportTask\"}],\"Default\":\"AlephExportTask\"},\"AlephExportTask\":{\"Next\":\"CurateExportTask\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"CurateExportTask\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"CurateExportTask\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"CurateExportTask\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "AlephExportLambda5493CE29",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"CurateExportTask\":{\"Next\":\"CurateLoopChoice\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"CollectionsApiTask\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"CollectionsApiTask\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"CollectionsApiTask\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "CurateExportLambdaAD553DAC",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"CurateLoopChoice\":{\"Type\":\"Choice\",\"Choices\":[{\"Variable\":\"$.curateHarvestComplete\",\"BooleanEquals\":false,\"Next\":\"CurateExportTask\"},{\"Variable\":\"$.curateHarvestComplete\",\"BooleanEquals\":true,\"Next\":\"CollectionsApiTask\"}],\"Default\":\"CollectionsApiTask\"},\"CollectionsApiTask\":{\"Next\":\"ObjectFilesApiTask\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"ObjectFilesApiTask\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"ObjectFilesApiTask\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"ObjectFilesApiTask\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "CollectionsApiLambdaEFE5F6DF",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"ObjectFilesApiTask\":{\"Next\":\"HarvestSucceed\",\"Catch\":[{\"ErrorEquals\":[\"Lambda.Unknown\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"HarvestFail\"},{\"ErrorEquals\":[\"States.TaskFailed\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"HarvestFail\"},{\"ErrorEquals\":[\"States.ALL\"],\"ResultPath\":\"$.unexpected\",\"Next\":\"HarvestFail\"}],\"Type\":\"Task\",\"OutputPath\":\"$.Payload\",\"Resource\":\"arn:",
              {
                "Ref": "AWS::Partition",
              },
              ":states:::lambda:invoke\",\"Parameters\":{\"FunctionName\":\"",
              {
                "Fn::GetAtt": [
                  "ObjectFilesApiLambda737B74E5",
                  "Arn",
                ],
              },
              "\",\"Payload.$\":\"$\"}},\"HarvestSucceed\":{\"Type\":\"Succeed\"},\"HarvestFail\":{\"Type\":\"Fail\"}}}",
            ],
          ],
        },

      }))
    })

  }) /* end of describe StateMachines */



  describe('Rules', () => {
    describe('when createEventRules is true', () => {
      test('creates StartStdJsonHarvestRule ', () => {
        const app = new cdk.App()

        const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
          domainName,
        })

        // WHEN
        manifestPipelineContext.createEventRules = true
        const stack = new ManifestPipelineStack(app, 'MyTestStack', {
          foundationStack,
          ...manifestPipelineContext,
        })

        // THEN
        expectCDK(stack).to(haveResourceLike('AWS::Events::Rule', {
          Description: "Start State Machine harvest of source systems to create standard json.",
          ScheduleExpression: "cron(0 6 * * ? *)",
        }))
      })

      test('creates StartManifestPipelineRule ', () => {
        const app = new cdk.App()

        const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
          domainName,
        })

        // WHEN
        manifestPipelineContext.createEventRules = true
        const stack = new ManifestPipelineStack(app, 'MyTestStack', {
          foundationStack,
          ...manifestPipelineContext,
        })

        // THEN
        expectCDK(stack).to(haveResourceLike('AWS::Events::Rule', {
          Description: "Start State Machine to create manifests.",
          ScheduleExpression: "cron(0 8 * * ? *)",
        }))
      })
    }) /* end of describe when createEventRules is true */

    describe('when createEventRules is false', () => {
      test('creates StartStdJsonHarvestRule ', () => {
        const app = new cdk.App()

        const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
          domainName,
        })

        // WHEN
        manifestPipelineContext.createEventRules = false
        const stack = new ManifestPipelineStack(app, 'MyTestStack', {
          foundationStack,
          ...manifestPipelineContext,
        })

        // THEN
        expectCDK(stack).notTo(haveResourceLike('AWS::Events::Rule', {
          Description: "Start State Machine harvest of source systems to create standard json.",
          ScheduleExpression: "cron(0 6 * * ? *)",
        }))
      })

      test('creates StartManifestPipelineRule ', () => {
        const app = new cdk.App()

        const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
          domainName,
        })

        // WHEN
        manifestPipelineContext.createEventRules = false
        const stack = new ManifestPipelineStack(app, 'MyTestStack', {
          foundationStack,
          ...manifestPipelineContext,
        })

        // THEN
        expectCDK(stack).notTo(haveResourceLike('AWS::Events::Rule', {
          Description: "Start State Machine to create manifests.",
          ScheduleExpression: "cron(0 8 * * ? *)",
        }))
      })
    }) /* end of describe when createEventRules is false */

  }) /* end of describe Rules */





}) /* end of describe ManifestPipelineStack */