import { expect as expectCDK, haveResource, haveResourceLike } from '@aws-cdk/assert'
import cdk = require('@aws-cdk/core')
import { FoundationStack } from '../../lib/foundation'
import { ManifestPipelineStack } from '../../lib/manifest-pipeline'
import { MaintainMetadataStack } from '../../lib/maintain-metadata'


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
  metadataTimeToLiveDays: "365",
  filesTimeToLiveDays: "365",
}

const maintainMetadataContext = {
}

describe('MaintainMetadataStack', () => {
  describe('GraphQL', () => {
    test('creates a GraphQL API', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::GraphQLApi', {
        AuthenticationType: "API_KEY",
        Name: "MyTestStack-api",
        XrayEnabled: true,
      }))
    })

    test('creates a GraphQL Schema', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResource('AWS::AppSync::GraphQLSchema'))
    })

    test('creates a GraphQL API Key', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::ApiKey', {
        ApiId: {
          "Fn::GetAtt": [
            "ApiF70053CD",
            "ApiId",
          ],
        },
      }))
    })
  }) /* end of describe GraphQL */

  describe('SSM Parameters', () => {
    test('creates SSMGraphqlApiUrl', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::SSM::Parameter', {
        Type: "String",
        Value: {
          "Fn::GetAtt": [
            "ApiF70053CD",
            "GraphQLUrl",
          ],
        },
        Description: "AppSync GraphQL base url",
        Name: "/all/stacks/MyTestStack/graphql-api-url",
      }))
    })

  }) /* end of describe SSM Parameters */


  describe('Data Sources', () => {
    test('creates WebsiteDynamoDataSource', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::DataSource', {
        Name: "WebsiteDynamoDataSource",
      }))
    })

  }) /* end of describe Data Sources */


  describe('Lambda', () => {
    test('creates RotateApiKeysLambdaFunction', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: "Rotates API Keys for AppSync - Maintain Metadata",
      }))
    })

    test('creates RotateAPIKeysRule', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Events::Rule', {
        Description: "Start lambda to rotate API keys.",
      }))
    })

  })

  describe('Functions', () => {
    test('creates GetMergedItemRecordFunction', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::FunctionConfiguration', {
        Name: "getMergedItemRecordFunction",
      }))
    })

    test('creates ExpandSubjectTermsFunction', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::FunctionConfiguration', {
        Name: "expandSubjectTermsFunction",
      }))
    })

  })



  describe('Resolvers', () => {
    test('creates FileFileGroupResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "File",
        FieldName: "FileGroup",
      }))
    })

    test('creates FileGroupFilesResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "FileGroup",
        FieldName: "files",
      }))
    })

    test('creates ItemMetadataDefaultFileResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "defaultFile",
      }))
    })

    test('creates ItemMetadataParentResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "parent",
      }))
    })

    test('creates ItemMetadataChildrenResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "children",
      }))
    })

    test('creates ItemMetadataFilesResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "files",
      }))
    })

    test('creates MutationAddItemMetadataToWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "addItemMetadataToWebsite",
      }))
    })

    test('creates MutationAddItemToWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "addItemToWebsite",
      }))
    })

    test('creates MutationRemoveItemFromWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removeItemFromWebsite",
      }))
    })

    test('creates MutationSaveAdditionalNotesForWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveAdditionalNotesForWebsite",
      }))
    })

    test('creates MutationSaveCopyrightForWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveCopyrightForWebsite",
      }))
    })

    test('creates MutationSaveDefaultImageForWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveDefaultImageForWebsite",
      }))
    })

    test('creates MutationSaveFileLastProcessedDateResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveFileLastProcessedDate",
      }))
    })

    test('creates MutationSavePartiallyDigitizedForWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePartiallyDigitizedForWebsite",
      }))
    })

    test('creates WebsiteItemItemMetadataResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "WebsiteItem",
        FieldName: "ItemMetadata",
      }))
    })


    test('creates MutationReplaceCopyrightStatement', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "replaceCopyrightStatement",
      }))
    })

    test('creates MutationReplaceDefaultImageResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "replaceDefaultImage",
      }))
    })

    test('creates MutationReplacePartiallyDigitizedResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "replacePartiallyDigitized",
      }))
    })

    test('creates QueryGetFileGroupResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getFileGroup",
      }))
    })

    test('creates QueryGetFileToProcessRecordResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getFileToProcessRecord",
      }))
    })

    test('creates QueryGetItemResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getItem",
      }))
    })

    test('creates QueryGetWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getWebsite",
      }))
    })

    test('creates QueryListFilesToProcessResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listFilesToProcess",
      }))
    })

    test('creates QueryListFileGroupsResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listFileGroups",
      }))
    })

    test('creates QueryListFileGroupsByStorageSystemResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listFileGroupsByStorageSystem",
      }))
    })

    test('creates QueryListFileGroupsForS3Resolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listFileGroupsForS3",
      }))
    })

    test('creates QueryListItemsBySourceSystemResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listItemsBySourceSystem",
      }))
    })

    test('creates QueryListItemsByWebsiteResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listItemsByWebsite",
      }))
    })

    test('creates QueryListWebsitesResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listWebsites",
      }))
    })

    test('creates WebsiteWebsiteItemsResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Website",
        FieldName: "websiteItems",
      }))
    })

    test('creates WebsiteItemsItemMetadataResolver', () => {
      const app = new cdk.App()
      const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
        domainName,
      })
      const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
        foundationStack,
        ...manifestPipelineContext,
      })

      // WHEN
      const stack = new MaintainMetadataStack(app, 'MyTestStack', {
        foundationStack,
        manifestPipelineStack,
        ...maintainMetadataContext,
      })

      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "WebsiteItems",
        FieldName: "ItemMetadata",
      }))
    })

  }) /* end of describe Resolvers */


}) /* end of describe ManifestPipelineStack */