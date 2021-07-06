import { expect as expectCDK, haveResource, haveResourceLike } from '@aws-cdk/assert'
import cdk = require('@aws-cdk/core')
import { FoundationStack } from '../../lib/foundation'
import { ManifestPipelineStack } from '../../lib/manifest-pipeline'
import { MaintainMetadataStack } from '../../lib/maintain-metadata'
import { Bucket } from '@aws-cdk/aws-s3'


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
}

const maintainMetadataContext = {
  openIdConnectProvider: "https://okta.nd.edu/oauth2/ausxosq06SDdaFNMB356",
}

describe('MaintainMetadataStack', () => {
  let stack: cdk.Stack

  beforeAll(() => {
    const app = new cdk.App()

    const foundationStack = new FoundationStack(app, `${namespace}-foundation`, {
      domainName,
    })
    const multimediaStack = new cdk.Stack(app, 'MultimediaStack')
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
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::GraphQLApi', {
        AuthenticationType: "OPENID_CONNECT",
        AdditionalAuthenticationProviders: [
          {
            AuthenticationType: "API_KEY",
          },
        ],
        Name: "MyTestStack-api",
        XrayEnabled: true,
      }))
    })

    test('creates a GraphQL Schema', () => {
      expectCDK(stack).to(haveResource('AWS::AppSync::GraphQLSchema'))
    })

    test('creates a GraphQL API Key', () => {
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
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::DataSource', {
        Name: "WebsiteDynamoDataSource",
      }))
    })

  }) /* end of describe Data Sources */


  describe('Lambda', () => {
    test('creates RotateApiKeysLambdaFunction', () => {
      expectCDK(stack).to(haveResourceLike('AWS::Lambda::Function', {
        Description: "Rotates API Keys for AppSync - Maintain Metadata",
      }))
    })

    test('creates RotateAPIKeysRule', () => {
      expectCDK(stack).to(haveResourceLike('AWS::Events::Rule', {
        Description: "Start lambda to rotate API keys.",
      }))
    })

  })

  describe('Functions', () => {
    test('creates GetMergedItemRecordFunction', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::FunctionConfiguration', {
        Name: "getMergedItemRecordFunction",
      }))
    })

    test('creates ExpandSubjectTermsFunction', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::FunctionConfiguration', {
        Name: "expandSubjectTermsFunction",
      }))
    })

  })



  describe('Resolvers', () => {
    test('creates FileFileGroupResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "File",
        FieldName: "FileGroup",
      }))
    })

    test('creates FileGroupFilesResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "FileGroup",
        FieldName: "files",
      }))
    })

    test('creates ImageGroupImagesResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ImageGroup",
        FieldName: "images",
      }))
    })

    test('creates ImageImageGroupResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Image",
        FieldName: "imageGroup",
      }))
    })

    test('creates ItemMetadataDefaultFileResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "defaultFile",
      }))
    })

    test('creates ItemMetadataDefaultImageResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "defaultImage",
      }))
    })

    test('creates ItemMetadataImagesResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "images",
      }))
    })

    test('creates ItemMetadataMediaResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "media",
      }))
    })

    test('creates MediaGroupMediaResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "MediaGroup",
        FieldName: "media",
      }))
    })

    test('creates MediaMediaGroupResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Media",
        FieldName: "mediaGroup",
      }))
    })

    test('creates ItemMetadataParentResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "parent",
      }))
    })

    test('creates ItemMetadataChildrenResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "children",
      }))
    })

    test('creates ItemMetadataFilesResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "ItemMetadata",
        FieldName: "files",
      }))
    })

    test('creates MutationAddItemToWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "addItemToWebsite",
      }))
    })

    test('creates MutationRemoveMediaGroupForWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removeMediaGroupForWebsite",
      }))
    })

    test('creates MutationRemovePortfolioCollectionResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removePortfolioCollection",
      }))
    })
    test('creates MutationRemovePortfolioItemResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removePortfolioItem",
      }))
    })
    test('creates MutationgetRemovePortfolioUserResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removePortfolioUser",
      }))
    })
    test('creates MutationSavePortfolioCollectionResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePortfolioCollection",
      }))
    })
    test('creates MutationSavePortfolioItemResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePortfolioItem",
      }))
    })
    test('creates MutationsavePortfolioUserResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePortfolioUser",
      }))
    })


    test('creates MutationAddItemToHarvestResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "addItemToHarvest",
      }))
    })

    test('creates MutationRemoveItemFromWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removeItemFromWebsite",
      }))
    })

    test('creates MutationRemoveDefaultImageForWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "removeDefaultImageForWebsite",
      }))
    })

    test('creates MutationSaveCopyrightForWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveCopyrightForWebsite",
      }))
    })

    test('creates MutationSaveDefaultImageForWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveDefaultImageForWebsite",
      }))
    })

    test('creates MutationSaveFileLastProcessedDateResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveFileLastProcessedDate",
      }))
    })

    test('creates MutationSavePartiallyDigitizedForWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "savePartiallyDigitizedForWebsite",
      }))
    })

    test('creates MutationSaveMediaGroupForWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Mutation",
        FieldName: "saveMediaGroupForWebsite",
      }))
    })

    test('creates WebsiteItemItemMetadataResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "WebsiteItem",
        FieldName: "ItemMetadata",
      }))
    })
    test('creates QueryGetPortfolioCollectionResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getPortfolioCollection",
      }))
    })
    test('creates QueryGetPortfolioItemResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getPortfolioItem",
      }))
    })
    test('creates QueryGetPortfolioUserResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getPortfolioUser",
      }))
    })
    test('creates QueryListImageGroupsResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listImageGroups",
      }))
    })
    test('creates QueryListImageGroupsForS3Resolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listImageGroupsForS3",
      }))
    })
    test('creates QueryListImageGroupsReferencedResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listImageGroupsReferenced",
      }))
    })

    test('creates QueryListMediaGroupsResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listMediaGroups",
      }))
    })
    test('creates QueryListMediaGroupsForS3Resolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listMediaGroupsForS3",
      }))
    })
    test('creates QueryListMediaGroupsReferencedResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listMediaGroupsReferenced",
      }))
    })

    test('creates QueryListPublicFeaturedPortfolioCollectionsResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listPublicFeaturedPortfolioCollections",
      }))
    })
    test('creates QueryListPublicHighlightedPortfolioCollectionsResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listPublicHighlightedPortfolioCollections",
      }))
    })
    test('creates QueryListPublicPortfolioCollectionsResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listPublicPortfolioCollections",
      }))
    })


    test('creates QueryGetFileGroupResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getFileGroup",
      }))
    })

    test('creates QueryGetFileToProcessRecordResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getFileToProcessRecord",
      }))
    })

    test('creates QueryGetFileResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getFile",
      }))
    })


    test('creates QueryGetImageResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getImage",
      }))
    })

    test('creates QueryGetImageGroupResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getImageGroup",
      }))
    })

    test('creates QueryGetItemResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getItem",
      }))
    })

    test('creates QueryGetMediaResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getMedia",
      }))
    })

    test('creates QueryGetMediaGroupResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getMediaGroup",
      }))
    })

    test('creates QueryGetWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "getWebsite",
      }))
    })

    test('creates QueryListFilesToProcessResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listFilesToProcess",
      }))
    })

    test('creates QueryListFileGroupsResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listFileGroups",
      }))
    })

    test('creates QueryListFileGroupsForS3Resolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listFileGroupsForS3",
      }))
    })

    test('creates QueryListItemsBySourceSystemResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listItemsBySourceSystem",
      }))
    })

    test('creates QueryListItemsByWebsiteResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listItemsByWebsite",
      }))
    })

    test('creates QueryListSupplementalDataRecordsResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listSupplementalDataRecords",
      }))
    })

    test('creates QueryListWebsitesResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Query",
        FieldName: "listWebsites",
      }))
    })

    test('creates WebsiteWebsiteItemsResolver', () => {
      expectCDK(stack).to(haveResourceLike('AWS::AppSync::Resolver', {
        TypeName: "Website",
        FieldName: "websiteItems",
      }))
    })

  }) /* end of describe Resolvers */


}) /* end of describe ManifestPipelineStack */