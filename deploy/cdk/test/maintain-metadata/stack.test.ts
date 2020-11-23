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
    test('creates Files Dynamo data source', () => {
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
        Name: "FilesDynamoDataSource",
      }))
    })

    test('creates Metadata Dynamo data source', () => {
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
        Name: "MetadataDynamoDataSource",
      }))
    })

    test('creates Metadata Augmentation Dynamo data source', () => {
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
        Name: "MetadataAugmentationDynamoDataSource",
      }))
    })
  }) /* end of describe Data Sources */


  describe('Resolvers', () => {
    test('creates MergedMetadataItem DefaultFile resolver', () => {
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
        FieldName: "defaultFile",
        TypeName: "MergedMetadataItem",
        DataSourceName: "FilesDynamoDataSource",
      }))
    })

    test('creates MergedMetadataItem Files resolver', () => {
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
        FieldName: "files",
        TypeName: "MergedMetadataItem",
        DataSourceName: "FilesDynamoDataSource",
      }))
    })

    test('creates MergedMetadataItem Items resolver', () => {
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
        FieldName: "items",
        TypeName: "MergedMetadataItem",
        DataSourceName: "MetadataDynamoDataSource",
      }))
    })

    test('creates MergedMetadataItem MetadataAugmentation resolver', () => {
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
        FieldName: "metadataAugmentation",
        TypeName: "MergedMetadataItem",
        DataSourceName: "MetadataAugmentationDynamoDataSource",
      }))
    })

    test('creates Mutation replaceDefaultImage resolver', () => {
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
        FieldName: "replaceDefaultImage",
        TypeName: "Mutation",
        DataSourceName: "MetadataAugmentationDynamoDataSource",
      }))
    })

    test('creates Mutation replacePartiallyDigitized resolver', () => {
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
        FieldName: "replacePartiallyDigitized",
        TypeName: "Mutation",
        DataSourceName: "MetadataAugmentationDynamoDataSource",
      }))
    })

    test('creates Query GetFile resolver', () => {
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
        FieldName: "getFile",
        TypeName: "Query",
        DataSourceName: "FilesDynamoDataSource",
      }))
    })

    test('creates Query GetMergedMetadata resolver', () => {
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
        FieldName: "getMergedMetadata",
        TypeName: "Query",
        DataSourceName: "MetadataDynamoDataSource",
      }))
    })

    test('creates Query GetMetadataAugmentation resolver', () => {
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
        FieldName: "getMetadataAugmentation",
        TypeName: "Query",
        DataSourceName: "MetadataAugmentationDynamoDataSource",
      }))
    })

    test('creates Query ListFiles resolver', () => {
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
        FieldName: "listFiles",
        TypeName: "Query",
        DataSourceName: "FilesDynamoDataSource",
      }))
    })

    test('creates Query ListMetadataAugmentations resolver', () => {
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
        FieldName: "listMetadataAugmentations",
        TypeName: "Query",
        DataSourceName: "MetadataAugmentationDynamoDataSource",
      }))
    })

    test('creates Query ListMergedMetadata resolver', () => {
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
        FieldName: "listMergedMetadata",
        TypeName: "Query",
        DataSourceName: "MetadataDynamoDataSource",
      }))
    })


  }) /* end of describe Resolvers */


}) /* end of describe ManifestPipelineStack */