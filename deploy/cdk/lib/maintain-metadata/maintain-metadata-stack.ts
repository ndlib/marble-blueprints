import { Construct, Duration, Expiration, Stack, StackProps, CfnOutput } from "@aws-cdk/core"
import { AuthorizationType, CfnResolver, FieldLogLevel, GraphqlApi, Resolver, Schema } from '@aws-cdk/aws-appsync'
import { DynamoDbDataSource, MappingTemplate } from '@aws-cdk/aws-appsync'
// import { Table } from '@aws-cdk/aws-dynamodb'
import { ParameterType, StringParameter } from '@aws-cdk/aws-ssm'
import { FoundationStack } from '../foundation'
import { ManifestPipelineStack } from '../manifest-pipeline'
import path = require('path')


export interface IMaintainMetadataStackProps extends StackProps {
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

  /**
   * The API Key for the Graphql API
   */
  public readonly maintainMetadataApiKey: string

  constructor(scope: Construct, id: string, props: IMaintainMetadataStackProps) {
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
      },
      xrayEnabled: true,
      logConfig: { fieldLogLevel: FieldLogLevel.ERROR },
    })

    this.maintainMetadataApiUrl = api.graphqlUrl
    this.maintainMetadataApiKey = api.apiKey || ''

    // Save values to Parameter Store (SSM) for later reference
    new StringParameter(this, 'SSMGraphqlApiUrl', {
      type: ParameterType.STRING,
      parameterName: `/all/stacks/${this.stackName}/graphql-api-url`,
      stringValue: api.graphqlUrl,
      description: 'AppSync GraphQL base url',
    })
    
    // TODO: change parameterName to /all/*s*tacks/ below (currently, stackName is AppSyncPlayground)
    new StringParameter(this, 'SSMGraphqlApiKey', {
      type: ParameterType.STRING,
      parameterName: `/all/stacks/${this.stackName}/graphql-api-key`,
      stringValue: api.apiKey || '',
      description: 'AppSync GraphQL API key',
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

    /* Note: At this point (CDK 1.70.0), the Resolver method is experimental, and is pretty limiting.  
      It allows passing an argument, but not reference to another source field.
      It also doesn't allow query expressions.  
      As a result, I'm forced to use CfnResolver.
    */
    new CfnResolver(this, 'MergedMetadataItemDefaultFileResolver', {
      apiId: api.apiId,
      typeName: 'MergedMetadataItem',
      fieldName: 'defaultFile',
      dataSourceName: filesDynamoDataSource.name,
      requestMappingTemplate: `{
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
              "id": $util.dynamodb.toDynamoDBJson($ctx.source.defaultFilePath),
          }
      }`,
      responseMappingTemplate: `$util.toJson($ctx.result)`,
    })

    // Note:  nextToken and limits aren't available in the experimental constructs yet, so we have to use cfn constructs.
    new CfnResolver(this, 'MergedMetadataItemFilesResolver', {
      apiId: api.apiId,
      typeName: 'MergedMetadataItem',
      fieldName: 'files',
      dataSourceName: filesDynamoDataSource.name,
      // Note:  removed from requestMappingTemplate below:
      //        "index": "fileId",
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "Query",
        "index": "fileId",
        "query": {
          "expression": "fileId = :objectFileGroupId",
          "expressionValues": {
            ":objectFileGroupId": {
              "S": "$context.source.objectFileGroupId"
            }
          }
        },
        "limit": #if($context.arguments.limit) $context.arguments.limit #else 10 #end,
        "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
      }`,
      responseMappingTemplate: `{
        "items": $util.toJson($context.result.items),
        "nextToken": $util.toJson($context.result.nextToken)
      }`,
    })

    // Note:  nextToken and limits aren't available in the experimental constructs yet, so we have to use cfn constructs.
    new CfnResolver(this, 'MergedMetadataItemItemsResolver', {
      apiId: api.apiId,
      typeName: 'MergedMetadataItem',
      fieldName: 'items',
      dataSourceName: metadataDynamoDataSource.name,
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "Query",
        "index": "parentId",
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
      }`,
      responseMappingTemplate: `{
        "items": $util.toJson($context.result.items),
        "nextToken": $util.toJson($context.result.nextToken)
      }`,
    })

    new CfnResolver(this, 'MergedMetadataItemMetadataAugmentationResolver', {
      apiId: api.apiId,
      typeName: 'MergedMetadataItem',
      fieldName: 'metadataAugmentation',
      dataSourceName: metadataAugmentationDynamoDataSource.name,
      requestMappingTemplate: `{
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
              "id": $util.dynamodb.toDynamoDBJson($ctx.source.id),
          }
      }`,
      responseMappingTemplate: `$util.toJson($ctx.result)`,
    })

    // Mutation resolvers
    new CfnResolver(this, 'MutationcreateMetadataAugmentationResolver', {
      apiId: api.apiId,
      typeName: 'Mutation',
      fieldName: 'createMetadataAugmentation',
      dataSourceName: metadataAugmentationDynamoDataSource.name,
      requestMappingTemplate: `{
          "version" : "2017-02-28",
          "operation" : "PutItem",
          "key" : {
              ## If object "id" should come from GraphQL arguments, change to $util.dynamodb.toDynamoDBJson($ctx.args.id)
              "id": $util.dynamodb.toDynamoDBJson($ctx.args.input.id),
          },
          "attributeValues" : $util.dynamodb.toMapValuesJson($ctx.args.input)
      }`,
      responseMappingTemplate: `$util.toJson($context.result)`,
    })

    new CfnResolver(this, 'MutationupdateMetadataAugmentationResolver', {
      apiId: api.apiId,
      typeName: 'Mutation',
      fieldName: 'updateMetadataAugmentation',
      dataSourceName: metadataAugmentationDynamoDataSource.name,
      requestMappingTemplate: `{
          "version" : "2017-02-28",
          "operation" : "PutItem",
          "key" : {
              ## If object "id" should come from GraphQL arguments, change to $util.dynamodb.toDynamoDBJson($ctx.args.id)
              "id": $util.dynamodb.toDynamoDBJson($ctx.args.input.id),
          },
          "attributeValues" : $util.dynamodb.toMapValuesJson($ctx.args.input)
      }`,
      responseMappingTemplate: `$util.toJson($context.result)`,
    })

    /* This works */
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

    /* this works */
    new Resolver(this, 'QueryGetMetadataAugmentationResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'getMetadataAugmentation',
      dataSource: metadataAugmentationDynamoDataSource,
      requestMappingTemplate: MappingTemplate.dynamoDbGetItem('id', 'id'),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    /* This works, but try another tactic */
    new CfnResolver(this, 'QueryListFilesResolver', {
      apiId: api.apiId,
      typeName: 'Query',
      fieldName: 'listFiles',
      dataSourceName: filesDynamoDataSource.name,
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "Scan",
        "filter": #if($context.args.filter) $util.transform.toDynamoDBFilterExpression($ctx.args.filter) #else null #end,
        "limit": $util.defaultIfNull($ctx.args.limit, 20),
        "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null)),
      }`,
      responseMappingTemplate: `$util.toJson($context.result)`,
    })

    new CfnResolver(this, 'QueryListMetadataAugmentationsResolver', {
      apiId: api.apiId,
      typeName: 'Query',
      fieldName: 'listMetadataAugmentations',
      dataSourceName: metadataAugmentationDynamoDataSource.name,
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "Scan",
        "filter": #if($context.args.filter) $util.transform.toDynamoDBFilterExpression($ctx.args.filter) #else null #end,
        "limit": $util.defaultIfNull($ctx.args.limit, 20),
        "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null)),
      }`,
      responseMappingTemplate: `$util.toJson($context.result)`,
    })

    new CfnResolver(this, 'QueryListMergedMetadataResolver', {
      apiId: api.apiId,
      typeName: 'Query',
      fieldName: 'listMergedMetadata',
      dataSourceName: metadataDynamoDataSource.name,
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "Scan",
        "filter": #if($context.args.filter) $util.transform.toDynamoDBFilterExpression($ctx.args.filter) #else null #end,
        "limit": $util.defaultIfNull($ctx.args.limit, 20),
        "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null)),
      }`,
      responseMappingTemplate: `$util.toJson($context.result)`,
    })

  }
}
