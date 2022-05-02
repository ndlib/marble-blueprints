import { Template } from 'aws-cdk-lib/assertions'
import { App, Stack } from 'aws-cdk-lib'
import { FoundationStack } from '../../lib/foundation'
import { ManifestPipelineStack } from '../../lib/manifest-pipeline'
import { MaintainMetadataStack } from '../../lib/maintain-metadata'
import { Bucket } from 'aws-cdk-lib/aws-s3'


const domainName = 'test.edu'
const namespace = 'marble'
const sentryDsn = 'https://136d489c91484b55be18e0a28d463b43@sentry.io/1831199'
const rBSCS3ImageBucketName = 'libnd-smb-rbsc'
const marbleContentBucketName = 'libnd-smb-marble'


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
  marbleContentBucketName,
  appConfigPath: "/all/test-marble",
  metadataTimeToLiveDays: "365",
  filesTimeToLiveDays: "365",
  marbleContentFileShareId: "some fake arn",
}

const maintainMetadataContext = {
  openIdConnectProvider: "https://okta.nd.edu/oauth2/ausxosq06SDdaFNMB356",
}

describe('MaintainMetadataStack', () => {
  let stack: Stack

  beforeAll(() => {
    const app = new App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const multimediaStack = new Stack(app, 'MultimediaStack')
    const multimediaBucket = new Bucket(multimediaStack, 'MultimediaBucket')

    const manifestPipelineStack = new ManifestPipelineStack(app, `${namespace}-manifest`, {
      foundationStack,
      multimediaBucket,
      ...manifestPipelineContext,
    })
    stack = new MaintainMetadataStack(app, 'MyTestStack', {
      foundationStack,
      manifestPipelineStack,
      ...maintainMetadataContext,
    })
  })

  describe('GraphQL', () => {
    test('creates a GraphQL API', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
        AuthenticationType: "OPENID_CONNECT",
        AdditionalAuthenticationProviders: [
          {
            AuthenticationType: "API_KEY",
          },
        ],
        Name: "MyTestStack-api",
        XrayEnabled: true,
      })
    })

    test('creates a GraphQL Schema', () => {
      const template = Template.fromStack(stack)
      template.resourceCountIs('AWS::AppSync::GraphQLSchema', 1)
    })

    test('creates a GraphQL API Key', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::ApiKey', {
        ApiId: {
          "Fn::GetAtt": [
            "ApiF70053CD",
            "ApiId",
          ],
        },
      })
    })
  }) /* end of describe GraphQL */

  describe('SSM Parameters', () => {
    test('creates SSMGraphqlApiUrl', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Type: "String",
        Value: {
          "Fn::GetAtt": [
            "ApiF70053CD",
            "GraphQLUrl",
          ],
        },
        Description: "AppSync GraphQL base url",
        Name: "/all/stacks/MyTestStack/graphql-api-url",
      })
    })

  }) /* end of describe SSM Parameters */


  describe('Data Sources', () => {
    test('creates WebsiteDynamoDataSource', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::DataSource', {
        Name: "WebsiteDynamoDataSource",
      })
    })

  }) /* end of describe Data Sources */


  describe('Lambda', () => {
    test('creates RotateApiKeysLambdaFunction', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Description: "Rotates API Keys for AppSync - Maintain Metadata",
      })
    })

    test('creates RotateAPIKeysRule', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::Events::Rule', {
        Description: "Start lambda to rotate API keys.",
      })
    })

  })

  describe('Functions', () => {
    test('creates GetMergedItemRecordFunction', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::FunctionConfiguration', {
        Name: "getMergedItemRecordFunction",
      })
    })

    test('creates ExpandSubjectTermsFunction', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::FunctionConfiguration', {
        Name: "expandSubjectTermsFunction",
      })
    })

    test('creates saveFileToProcessRecordFunction', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::FunctionConfiguration', {
        Name: "saveFileToProcessRecordFunction",
      })
    })

    test('creates updateImageRecordFunction', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::FunctionConfiguration', {
        Name: "updateImageRecordFunction",
      })
    })

  })



  describe('Resolvers', () => {
    test('creates ImageGroupImagesResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "ImageGroup",
        FieldName: "images",
      })
    })

    test('creates ImageImageGroupResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Image",
        FieldName: "imageGroup",
      })
    })

    test('creates ItemMetadataDefaultImageResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "defaultImage",
      })
    })

    test('creates ItemMetadataImagesResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "images",
      })
    })

    test('creates ItemMetadataMediaResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "media",
      })
    })

    test('creates MediaGroupMediaResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "MediaGroup",
        FieldName: "media",
      })
    })

    test('creates MediaMediaGroupResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Media",
        FieldName: "mediaGroup",
      })
    })

    test('creates ItemMetadataParentResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "parent",
      })
    })

    test('creates ItemMetadataChildrenResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "children",
      })
    })

    test('creates MutationAddItemToWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "addItemToWebsite",
      })
    })

    test('creates MutationRemoveMediaGroupForWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removeMediaGroupForWebsite",
      })
    })

    test('creates MutationRemovePortfolioCollectionResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removePortfolioCollection",
      })
    })
    test('creates MutationRemovePortfolioItemResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removePortfolioItem",
      })
    })
    test('creates MutationgetRemovePortfolioUserResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removePortfolioUser",
      })
    })
    test('creates MutationSavePortfolioCollectionResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePortfolioCollection",
      })
    })
    test('creates MutationSavePortfolioItemResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePortfolioItem",
      })
    })
    test('creates MutationsavePortfolioUserResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePortfolioUser",
      })
    })


    test('creates MutationAddItemToHarvestResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "addItemToHarvest",
      })
    })

    test('creates MutationRemoveItemFromWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removeItemFromWebsite",
      })
    })

    test('creates MutationRemoveItemToProcessResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removeItemToProcess",
      })
    })

    test('creates MutationRemoveDefaultImageForWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removeDefaultImageForWebsite",
      })
    })

    test('creates MutationSaveCopyrightForWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveCopyrightForWebsite",
      })
    })

    test('creates MutationSaveDefaultImageForWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveDefaultImageForWebsite",
      })
    })

    test('creates MutationSaveFileLastProcessedDateResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveFileLastProcessedDate",
      })
    })

    test('creates MutationSavePartiallyDigitizedForWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePartiallyDigitizedForWebsite",
      })
    })

    test('creates MutationSaveMediaGroupForWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveMediaGroupForWebsite",
      })
    })

    test('creates WebsiteItemItemMetadataResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "WebsiteItem",
        FieldName: "ItemMetadata",
      })
    })

    test('creates PortfolioUserPortfolioCollectionsResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "PortfolioUser",
        FieldName: "portfolioCollections",
      })
    })

    test('creates PortfolioCollectionCreatorResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "PortfolioCollection",
        FieldName: "creator",
      })
    })

    test('creates QueryGetPortfolioCollectionResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getPortfolioCollection",
      })
    })
    test('creates QueryGetPortfolioItemResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getPortfolioItem",
      })
    })
    test('creates QueryGetPortfolioUserResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getPortfolioUser",
      })
    })
    test('creates QueryListImageGroupsResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listImageGroups",
      })
    })
    test('creates QueryListImageGroupsForS3Resolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listImageGroupsForS3",
      })
    })
    test('creates QueryListImageGroupsReferencedResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listImageGroupsReferenced",
      })
    })

    test('creates QueryListMediaGroupsResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listMediaGroups",
      })
    })
    test('creates QueryListMediaGroupsForS3Resolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listMediaGroupsForS3",
      })
    })
    test('creates QueryListMediaGroupsReferencedResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listMediaGroupsReferenced",
      })
    })

    test('creates QueryListPublicFeaturedPortfolioCollectionsResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listPublicFeaturedPortfolioCollections",
      })
    })
    test('creates QueryListPublicHighlightedPortfolioCollectionsResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listPublicHighlightedPortfolioCollections",
      })
    })
    test('creates QueryListPublicPortfolioCollectionsResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listPublicPortfolioCollections",
      })
    })

    test('creates QueryGetFileToProcessRecordResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getFileToProcessRecord",
      })
    })

    test('creates QueryGetImageResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getImage",
      })
    })

    test('creates QueryGetImageGroupResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getImageGroup",
      })
    })

    test('creates QueryGetItemResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getItem",
      })
    })

    test('creates QueryGetMediaResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getMedia",
      })
    })

    test('creates QueryGetMediaGroupResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getMediaGroup",
      })
    })

    test('creates QueryGetWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getWebsite",
      })
    })

    test('creates QueryListFilesToProcessResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listFilesToProcess",
      })
    })

    test('creates QueryListItemsBySourceSystemResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listItemsBySourceSystem",
      })
    })

    test('creates QueryListItemsByWebsiteResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listItemsByWebsite",
      })
    })

    test('creates QueryListSupplementalDataRecordsResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listSupplementalDataRecords",
      })
    })

    test('creates QueryListWebsitesResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listWebsites",
      })
    })

    test('creates WebsiteWebsiteItemsResolver', () => {
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: "Website",
        FieldName: "websiteItems",
      })
    })

  }) /* end of describe Resolvers */


}) /* end of describe ManifestPipelineStack */