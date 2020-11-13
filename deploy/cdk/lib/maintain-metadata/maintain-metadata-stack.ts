import { Construct, Duration, Expiration, Stack, StackProps, CfnOutput } from "@aws-cdk/core"
import { AuthorizationType, FieldLogLevel, GraphqlApi, Resolver, Schema } from '@aws-cdk/aws-appsync'
import { DynamoDbDataSource, MappingTemplate } from '@aws-cdk/aws-appsync'
import { ParameterType, StringParameter } from '@aws-cdk/aws-ssm'
import { FoundationStack } from '../foundation'
import { ManifestPipelineStack } from '../manifest-pipeline'
import path = require('path')


export interface IBaseStackProps extends StackProps {
  /**
   * The name of the foundation stack upon which this stack is dependent
   */
  readonly foundationStack: FoundationStack;

  /**
   * The name of the manifest pipeline stack which defines dynamodb tables used here
   */
  readonly manifestPipelineStack: ManifestPipelineStack;
}

export class MaintainMetadataStack extends Stack {
  /**
   * The Url for the Graphql API
   */
  public readonly maintainMetadataApiUrl: string

  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props)

    // Define construct contents here
    const apiSchema = Schema.fromAsset(path.join(__dirname, 'schema.graphql'))

    const api = new GraphqlApi(this, 'Api', {
      name: `${this.stackName}-api`,
      schema: apiSchema,
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: Expiration.after(Duration.days(365)),
          },
        },
        additionalAuthorizationModes: [{ authorizationType: AuthorizationType.IAM }],
      },
      xrayEnabled: true,
      logConfig: { fieldLogLevel: FieldLogLevel.ERROR },
    })

    this.maintainMetadataApiUrl = api.graphqlUrl

    // Save values to Parameter Store (SSM) for later reference
    new StringParameter(this, 'SSMGraphqlApiUrl', {
      type: ParameterType.STRING,
      parameterName: `/all/stacks/${this.stackName}/graphql-api-url`,
      stringValue: api.graphqlUrl,
      description: 'AppSync GraphQL base url',
    })
    
    // print out the AppSync GraphQL endpoint to the terminal
    new CfnOutput(this, `${this.stackName}:ApiUrl`, {
      value: api.graphqlUrl,
      exportName: `${this.stackName}:ApiUrl`,
    })


    // Add Data Sources
    const filesTable = props.manifestPipelineStack.filesDynamoTable
    const filesDynamoDataSource = new DynamoDbDataSource(this, 'FilesDynamoDataSource', {
      api: api,
      table: filesTable,
      readOnlyAccess: true,
    })

    const metadataTable = props.manifestPipelineStack.metadataDynamoTable
    const metadataDynamoDataSource = new DynamoDbDataSource(this, 'MetadataDynamoDataSource', {
      api: api,
      table: metadataTable,
      readOnlyAccess: true,
    })

    const metadataAugmentationTable = props.manifestPipelineStack.metadataAugmentationDynamoTable
    const metadataAugmentationDynamoDataSource = new DynamoDbDataSource(this, 'MetadataAugmentationDynamoDataSource', {
      api: api,
      table: metadataAugmentationTable,
      readOnlyAccess: false,
    })


    new Resolver(this, 'MergedMetadataItemDefaultFileResolver', {
      api: api,
      typeName: 'MergedMetadataItem',
      fieldName: 'defaultFile',
      dataSource: filesDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
              "id": $util.dynamodb.toDynamoDBJson($ctx.source.defaultFilePath),
          }
      }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MergedMetadataItemFilesResolver', {
      api: api,
      typeName: 'MergedMetadataItem',
      fieldName: 'files',
      dataSource: filesDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
        "version": "2017-02-28",
        "operation": "Query",
        "index": "objectFileGroupIdIndex",
        "query": {
          "expression": "objectFileGroupId = :objectFileGroupId",
          "expressionValues": {
            ":objectFileGroupId": {
              "S": "$context.source.objectFileGroupId"
            }
          }
        },
        "limit": #if($context.arguments.limit) $context.arguments.limit #else 10 #end,
        "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
      }`),
      responseMappingTemplate: MappingTemplate.fromString(`{
        "items": $util.toJson($context.result.items),
        "nextToken": $util.toJson($context.result.nextToken)
      }`),
    })

    new Resolver(this, 'MergedMetadataItemItemsResolver', {
      api: api,
      typeName: 'MergedMetadataItem',
      fieldName: 'items',
      dataSource: metadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
        "version": "2017-02-28",
        "operation": "Query",
        "index": "parentIdIndex",
        "query": {
          "expression": "parentId = :id",
          "expressionValues": {
            ":id": {
              "S": "$context.source.id"
            }
          }
        },
        "limit": #if($context.arguments.limit) $context.arguments.limit #else 10 #end,
        "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
      }`),
      responseMappingTemplate: MappingTemplate.fromString(`{
        "items": $util.toJson($context.result.items),
        "nextToken": $util.toJson($context.result.nextToken)
      }`),
    })

    new Resolver(this, 'MergedMetadataItemMetadataAugmentationResolver', {
      api: api,
      typeName: 'MergedMetadataItem',
      fieldName: 'metadataAugmentation',
      dataSource: metadataAugmentationDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
              "id": $util.dynamodb.toDynamoDBJson($ctx.source.id),
          }
      }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })


    // Mutation resolvers
    new Resolver(this, 'MutationReplaceDefaultImageResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'replaceDefaultImage',
      dataSource: metadataAugmentationDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
        "version": "2017-02-28",
        "operation": "UpdateItem",
        "key": {
          "id": $util.dynamodb.toDynamoDBJson($ctx.args.input.id)
        },
        "update": {
          "expression": "SET collectionId = :collectionId, generalDefaultFilePath = :generalDefaultFilePath, generalObjectFileGroupId = :generalObjectFileGroupId",
          "expressionValues": {
            ":collectionId": $util.dynamodb.toDynamoDBJson($ctx.args.input.collectionId),      
            ":generalDefaultFilePath": $util.dynamodb.toDynamoDBJson($ctx.args.input.generalDefaultFilePath),
            ":generalObjectFileGroupId": $util.dynamodb.toDynamoDBJson($ctx.args.input.generalObjectFileGroupId)      
          }
        }
      }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationReplacePartiallyDigitizedResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'replacePartiallyDigitized',
      dataSource: metadataAugmentationDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
        "version": "2017-02-28",
        "operation": "UpdateItem",
        "key": {
          "id": $util.dynamodb.toDynamoDBJson($ctx.args.input.id)
        },
        "update": {
          "expression": "SET collectionId = :collectionId, generalPartiallyDigitized = :generalPartiallyDigitized",
          "expressionValues": {
            ":collectionId": $util.dynamodb.toDynamoDBJson($ctx.args.input.collectionId)    
            ":generalPartiallyDigitized": $util.dynamodb.toDynamoDBJson($ctx.args.input.generalPartiallyDigitized)
          }
        }
      }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetFileResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'getFile',
      dataSource: filesDynamoDataSource,
      requestMappingTemplate: MappingTemplate.dynamoDbGetItem('id', 'id'),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetMergedMetadataResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'getMergedMetadata',
      dataSource: metadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.dynamoDbGetItem('id', 'id'),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetMetadataAugmentationResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'getMetadataAugmentation',
      dataSource: metadataAugmentationDynamoDataSource,
      requestMappingTemplate: MappingTemplate.dynamoDbGetItem('id', 'id'),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryListFilesResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'listFiles',
      dataSource: filesDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
        "version": "2017-02-28",
        "operation": "Scan",
        "filter": #if($context.args.filter) $util.transform.toDynamoDBFilterExpression($ctx.args.filter) #else null #end,
        "limit": $util.defaultIfNull($ctx.args.limit, 20),
        "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null)),
      }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryListMetadataAugmentationsResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'listMetadataAugmentations',
      dataSource: metadataAugmentationDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
        "version": "2017-02-28",
        "operation": "Scan",
        "filter": #if($context.args.filter) $util.transform.toDynamoDBFilterExpression($ctx.args.filter) #else null #end,
        "limit": $util.defaultIfNull($ctx.args.limit, 20),
        "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null)),
      }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryListMergedMetadataResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'listMergedMetadata',
      dataSource: metadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`{
        "version": "2017-02-28",
        "operation": "Scan",
        "filter": #if($context.args.filter) $util.transform.toDynamoDBFilterExpression($ctx.args.filter) #else null #end,
        "limit": $util.defaultIfNull($ctx.args.limit, 20),
        "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null)),
      }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

  }
}
