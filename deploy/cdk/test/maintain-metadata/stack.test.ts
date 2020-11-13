import { expect as expectCDK, haveResourceLike } from '@aws-cdk/assert'
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
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::GraphQLSchema', {
        Definition: "type File {\n\tid: String!\n\teTag: String\n\texpireTime: Int\n\tiiifImageUri: String\n\tiiifUri: String\n\tkey: String\n\tlabel: String\n\tlastModified: String\n\tobjectFileGroupId: String!\n\tpath: String\n\tsequence: Int\n\tsize: Int\n\tsource: String\n\tsourceType: String\n\tsourceUri: String\n\tstorageClass: String\n}\n\ntype FilesConnection {\n\titems: [File]\n\tnextToken: String\n}\n\ntype MergedMetadataItem {\n\tid: String!\n\tcollectionId: String\n\tcollections: [MetadataObjectWithDisplayField]\n\tcontributors: [MetadataObjectWithDisplayField]\n\tcopyrightStatement: String\n\tcopyrightStatus: String\n\tcopyrightUrl: String\n\tcreatedDate: String\n\tcreators: [MetadataObjectWithDisplayField]\n\tdedication: String\n\tdefaultFile: File\n\tdefaultFilePath: String\n\tdescription: String\n\tdigitalAccess: String\n\tdimensions: String\n\texpireTime: Int\n\tfileCreatedDate: String\n\tformat: String\n\tgeographicLocations: [MetadataObjectWithDisplayField]\n\tiiifUri: String\n\tlanguages: [MetadataObjectWithDisplayField]\n\tlevel: String\n\tlinkToSource: String\n\tobjectFileGroupId: String\n\tparentId: String\n\tpublishers: [MetadataObjectWithDisplayField]\n\trelatedIds: [String]\n\trepository: String\n\tsequence: Int\n\tsourceSystem: String\n\tsubjects: [MetadataSubject]\n\ttitle: String\n\tuniqueIdentifier: String\n\tworkType: String\n\tfiles(limit: Int, nextToken: String): FilesConnection\n\titems(limit: Int, nextToken: String): MergedMetadataConnection\n\tmetadataAugmentation: MetadataAugmentation\n}\n\ntype MergedMetadataConnection {\n\titems: [MergedMetadataItem]\n\tnextToken: String\n}\n\ntype MetadataAugmentation {\n\tid: String!\n\tcollectionId: String\n\tgeneralDefaultFilePath: String\n\tgeneralDefaultImageId: String\n\tgeneralObjectFileGroupId: String\n\tgeneralPartiallyDigitized: Boolean\n}\n\ntype MetadataAugmentationConnection {\n\titems: [MetadataAugmentation]\n\tnextToken: String\n}\n\ntype MetadataObjectWithDisplayField {\n\tdisplay: String\n}\n\ntype MetadataSubject {\n\tterm: String\n\turi: String\n\tauthority: String\n\tvariants: [String]\n\tdisplay: String\n\tparentTerm: String\n\tbroaderTerms: [MetadataSubject]\n}\n\ntype Mutation {\n\tcreateMetadataAugmentation(input: ReplaceDefaultImageInput!): MetadataAugmentation\n\tupdateMetadataAugmentation(input: ReplaceDefaultImageInput!): MetadataAugmentation\n\treplaceDefaultImage(input: ReplaceDefaultImageInput!): MetadataAugmentation\n\treplacePartiallyDigitized(input: ReplacePartiallyDigitizedInput): MetadataAugmentation\n}\n\ntype Query {\n\tgetFile(id: String!): File\n\tgetMergedMetadata(id: String!): MergedMetadataItem\n\tgetMetadataAugmentation(id: String!): MetadataAugmentation\n\tlistFiles(filter: TableFilesFilterInput, limit: Int, nextToken: String): FilesConnection\n\tlistMergedMetadata(filter: TableMergedMetadataFilterInput, limit: Int, nextToken: String): MergedMetadataConnection\n\tlistMetadataAugmentations(filter: TableMetadataAugmentationFilterInput, limit: Int, nextToken: String): MetadataAugmentationConnection\n}\n\ninput ReplaceDefaultImageInput {\n\tid: String!\n\tcollectionId: String!\n\tgeneralDefaultFilePath: String!\n\tgeneralObjectFileGroupId: String!\n}\n\ninput ReplacePartiallyDigitizedInput {\n\tid: String!\n\tcollectionId: String!\n\tgeneralPartiallyDigitized: Boolean!\n}\n\ntype Subscription {\n\tonCreateMetadataAugmentation(id: String, collectionId: String): MetadataAugmentation\n\t\t@aws_subscribe(mutations: [\"createMetadataAugmentation\"])\n\tonUpdateMetadataAugmentation(id: String, collectionId: String): MetadataAugmentation\n\t\t@aws_subscribe(mutations: [\"updateMetadataAugmentation\"])\n}\n\ninput TableBooleanFilterInput {\n\tne: Boolean\n\teq: Boolean\n}\n\ninput TableFilesFilterInput {\n\tid: TableStringFilterInput\n\tObjectFileGroupId: TableStringFilterInput\n}\n\ninput TableFloatFilterInput {\n\tne: Float\n\teq: Float\n\tle: Float\n\tlt: Float\n\tge: Float\n\tgt: Float\n\tcontains: Float\n\tnotContains: Float\n\tbetween: [Float]\n}\n\ninput TableIDFilterInput {\n\tne: ID\n\teq: ID\n\tle: ID\n\tlt: ID\n\tge: ID\n\tgt: ID\n\tcontains: ID\n\tnotContains: ID\n\tbetween: [ID]\n\tbeginsWith: ID\n}\n\ninput TableIntFilterInput {\n\tne: Int\n\teq: Int\n\tle: Int\n\tlt: Int\n\tge: Int\n\tgt: Int\n\tcontains: Int\n\tnotContains: Int\n\tbetween: [Int]\n}\n\ninput TableMergedMetadataFilterInput {\n\tid: TableStringFilterInput\n\tiiifUri: TableStringFilterInput\n\tlevel: TableStringFilterInput\n\tobjectFileGroupId: TableStringFilterInput\n\tparentId: TableStringFilterInput\n\tsourceSystem: TableStringFilterInput\n\ttitle: TableStringFilterInput\n}\n\ninput TableMetadataAugmentationFilterInput {\n\tid: TableStringFilterInput\n\tcollectionId: TableStringFilterInput\n}\n\ninput TableStringFilterInput {\n\tne: String\n\teq: String\n\tle: String\n\tlt: String\n\tge: String\n\tgt: String\n\tcontains: String\n\tnotContains: String\n\tbetween: [String]\n\tbeginsWith: String\n}\n\nschema {\n\tquery: Query\n\tmutation: Mutation\n\tsubscription: Subscription\n}",
      }))
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
  }) /* end of describe Buckets */

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