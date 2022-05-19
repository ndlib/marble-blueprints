import { Duration, Expiration, Fn, Stack, StackProps } from "aws-cdk-lib"
import { AppsyncFunction, AuthorizationType, DynamoDbDataSource, FieldLogLevel, GraphqlApi, MappingTemplate, Resolver, Schema } from '@aws-cdk/aws-appsync-alpha'
import { Rule, Schedule } from "aws-cdk-lib/aws-events"
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets"
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda"
import { ParameterType, StringParameter } from 'aws-cdk-lib/aws-ssm'
import { Construct } from "constructs"
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

  /**
   *
   * OpenID Connect provider
   */
  readonly openIdConnectProvider: string
}

export class MaintainMetadataStack extends Stack {

  /**
   * GraphQL API Url Key Path
   */
  public readonly graphqlApiUrlKeyPath: string

  /**
   * GraphQL API Key Key Path - I know this looks odd duplicating "Key", but this is the key path for the api key
   */
  public readonly graphqlApiKeyKeyPath: string

  /**
   * GraphQL API ID Key Path
   */
  public readonly graphqlApiIdKeyPath: string

  /**
   * SSM Base Path to all SSM parameters created here
   */
  public readonly maintainMetadataKeyBase: string

  /**
   * The AppSync API Identifier
   */
  public readonly apiId: string

  public readonly api: GraphqlApi

  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props)

    const daysForKeyToLast = 7

    // Define construct contents here
    const apiSchema = Schema.fromAsset(path.join(__dirname, 'schema.graphql'))

    this.api = new GraphqlApi(this, 'Api', {
      name: `${this.stackName}-api`,
      schema: apiSchema,
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.OIDC,
          openIdConnectConfig: {
            oidcProvider: props.openIdConnectProvider,
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: AuthorizationType.API_KEY,
            apiKeyConfig: {
              expires: Expiration.after(Duration.days(daysForKeyToLast)),
            },
          },
        ],
      },
      xrayEnabled: true,
      logConfig: { fieldLogLevel: FieldLogLevel.ERROR },
    })
    this.apiId = this.api.apiId

    // This will need to be populated separately
    this.graphqlApiUrlKeyPath = `/all/stacks/${this.stackName}/graphql-api-url`

    this.maintainMetadataKeyBase = `/all/stacks/${this.stackName}`

    // Save values to Parameter Store (SSM) for later reference
    new StringParameter(this, 'SSMGraphqlApiUrl', {
      type: ParameterType.STRING,
      parameterName: this.graphqlApiUrlKeyPath,
      stringValue: this.api.graphqlUrl,
      description: 'AppSync GraphQL base url',
    })

    this.graphqlApiKeyKeyPath = `/all/stacks/${this.stackName}/graphql-api-key`

    this.graphqlApiIdKeyPath = `/all/stacks/${this.stackName}/graphql-api-id`
    new StringParameter(this, 'SSMGraphqlApiId', {
      type: ParameterType.STRING,
      parameterName: this.graphqlApiIdKeyPath,
      stringValue: this.api.apiId,
      description: 'AppSync GraphQL base id',
    })


    // Add Lambda to rotate API Keys
    const rotateApiKeysLambda = new Function(this, 'RotateApiKeysLambdaFunction', {
      code: Code.fromInline(`
import boto3
import botocore
import datetime
import os


def run(event, _context):
    """ save string API Key as SecureString """
    graphql_api_id_key_path = os.environ.get('GRAPHQL_API_ID_KEY_PATH')
    graphql_api_key_key_path = os.environ.get('GRAPHQL_API_KEY_KEY_PATH')
    days_for_key_to_last = int(os.environ.get('DAYS_FOR_KEY_TO_LAST', 7))
    if graphql_api_id_key_path:
        graphql_api_id = _get_parameter(graphql_api_id_key_path)
        print("graphql_api_id =", graphql_api_id)
        if graphql_api_id and graphql_api_key_key_path:
            expire_time = _get_expire_time(days_for_key_to_last)
            new_api_key = _generate_new_api_key(graphql_api_id, expire_time)
            if new_api_key:
                print("new key generated")
                _save_secure_parameter(graphql_api_key_key_path, new_api_key)
                print("saved new key here =", graphql_api_key_key_path)
                _delete_expired_api_keys(graphql_api_id)
    return event


def _get_parameter(name: str) -> str:
    try:
        response = boto3.client('ssm').get_parameter(Name=name, WithDecryption=True)
        value = response.get('Parameter').get('Value')
        return value
    except botocore.exceptions.ClientError:
        return None


def _get_expire_time(days: int) -> int:
    if days > 364:  # AppSync requires a key to expire less than 365 days in the future
        days = 364
    new_expire_time = (datetime.datetime.now() + datetime.timedelta(days=days)).timestamp()
    return int(new_expire_time)


def _generate_new_api_key(graphql_api_id: str, new_expire_time: int) -> str:
    response = boto3.client('appsync').create_api_key(apiId=graphql_api_id, description='auto maintained api key', expires=new_expire_time)
    key_id = response.get('apiKey').get('id')
    return key_id


def _save_secure_parameter(name: str, key_id: str) -> bool:
    boto3.client('ssm').put_parameter(Name=name, Description='api key for graphql-api-url', Value=key_id, Type='SecureString', Overwrite=True)


def _delete_expired_api_keys(graphql_api_id: str):
    response = boto3.client('appsync').list_api_keys(apiId=graphql_api_id)
    for api_key in response.get('apiKeys'):
        if api_key.get('expires') < datetime.datetime.now().timestamp() and api_key.get('description') == 'auto maintained api key':
            boto3.client('appsync').delete_api_key(apiId=graphql_api_id, id=api_key.get('id'))
`),
      description: 'Rotates API Keys for AppSync - Maintain Metadata',
      handler: 'index.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        GRAPHQL_API_ID_KEY_PATH: this.graphqlApiIdKeyPath,
        GRAPHQL_API_KEY_KEY_PATH: this.graphqlApiKeyKeyPath,
        DAYS_FOR_KEY_TO_LAST: String(daysForKeyToLast),
      },
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'appsync:CreateApiKey',
            'appsync:DeleteApiKey',
            'appsync:ListApiKeys',
          ],
          resources: [
            Fn.sub('arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:/v1/apis/') + this.api.apiId + '/apikeys*',
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "ssm:GetParametersByPath",
            "ssm:GetParameter",
          ],
          resources: [Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + this.graphqlApiIdKeyPath)],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ssm:PutParameter"],
          resources: [Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + this.graphqlApiKeyKeyPath)],
        }),
      ],
      timeout: Duration.seconds(90),
    })

    new Rule(this, 'RotateAPIKeysRule', {
      schedule: Schedule.cron({ minute: '0', hour: '0' }),
      targets: [new LambdaFunction(rotateApiKeysLambda)],
      description: 'Start lambda to rotate API keys.',
    })

    // Add Data Sources
    const websiteMetadataTable = props.manifestPipelineStack.websiteMetadataDynamoTable
    const websiteMetadataDynamoDataSource = new DynamoDbDataSource(this, 'WebsiteDynamoDataSource', {
      api: this.api,
      table: websiteMetadataTable,
      readOnlyAccess: false,
    })


    // Add Functions
    const getMergedItemRecordFunction = new AppsyncFunction(this, 'GetMergedItemRecordFunction', {
      api: this.api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'getMergedItemRecordFunction',
      description: 'Used to read all records for an Item from DynamoDB.',
      requestMappingTemplate: MappingTemplate.fromString(`
        #######################################
        ## This function returns the requested item record enhanced by ALL website overrides and the overrides for the specific website requested (if any)
        ## itemId cannot be null, websiteId may be null
        ## itemId will be pulled from
        ##    1. stash ($ctx.stash.itemId)
        ##    2. source itemId ($ctx.source.itemId)
        ##    3. source id ($ctx.source.id)
        ##    4. source itemMetadataId ($ctx.source.itemMetadataId)  // This will be obsolete after we update Red Box
        ## websiteId will be pulled:
        ##    1 from stash ($ctx.stash.websiteId)
        ##    2 if not found in stash, from source.suppliedWebsiteId
        #######################################

        #set($id = $util.defaultIfNullOrBlank($ctx.stash.itemId, $ctx.source.itemId))
        #set($id = $util.defaultIfNullOrBlank($id, $ctx.source.id))
        #set($id = $util.defaultIfNullOrBlank($is, $ctx.source.itemMetadataId))

        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($suppliedWebsiteId = $util.defaultIfNullOrBlank($ctx.stash.websiteId, $ctx.source.suppliedWebsiteId))
        #set($suppliedWebsiteId = $util.defaultIfNullOrBland($suppliedWebsiteId, ""))
        $!{ctx.stash.put("suppliedWebsiteId", $suppliedWebsiteId)}

        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($pk = "ITEM#$id")

        ## Query all records based on the primary key

        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query": {
              "expression": "PK = :id",
              "expressionValues": {
                ":id": $util.dynamodb.toDynamoDBJson("$pk")
              }
            },
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        ## Raise a GraphQL field error in case of a datasource invocation error
        #if($ctx.error)
            $util.error($ctx.error.message, $ctx.error.type)
        #end
        ## Pass back the result from DynamoDB. **
        ### Add extra processing here to try to generate a single record of output
        #set($results = {})
        #set($suppliedWebsiteId = $util.str.toUpper($util.defaultIfNullOrBlank($ctx.stash.suppliedWebsiteId, "")))

        #foreach($item in $context.result.items)
          #set($websiteInRecord = $util.str.toUpper($util.defaultIfNullOrBlank($item.websiteId, "")))
          #if( $item.TYPE == "Item" )
            #set($results = $item)
            ## store suppliedWebsiteId in results for subsequent use
            #set($results["suppliedWebsiteId"] = $suppliedWebsiteId)
          #elseif( $item.TYPE == "ParentOverride" )
            ## $!(results.put("parentId", "$item.parentId"))
            #set($results["parentId"] = $item.parentId)
          #elseif( $item.TYPE == "SupplementalData" && ($suppliedWebsiteId == $websiteInRecord || $websiteInRecord == "ALL"))
            #foreach( $entry in $util.map.copyAndRemoveAllKeys($item, ["PK","SK","TYPE","GSI1PK","GSI1SK","GSI2PK","GSI2SK","dateAddedToDynamo","dateModifiedInDynamo"]).entrySet() )
              ## $!{results.put("$entry.key", "$entry.value")}
              #set($results[$entry.key] = $entry.value)
           #end
          #end
        #end
        $util.toJson($results)
        $!{ctx.stash.put("itemRecord", $results)}
      `),
    })

    const expandSubjectTermsFunction = new AppsyncFunction(this, 'ExpandSubjectTermsFunction', {
      api: this.api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'expandSubjectTermsFunction',
      description: 'Used to read all records for an Item from DynamoDB.',
      requestMappingTemplate: MappingTemplate.fromString(`
        #######################################
        ## This function accepts a stashed Item record.
        ## It will accumulate all subject terms with a uri defined to be used as a Dynamo BatchGetItem.
        ## Once the query is performed, we will loop through the results, replacing each original Subject entry with the appropriate expanded entry
        #######################################

        #set($subjects = $ctx.stash.itemRecord.subjects)
        $!{ctx.stash.put("subjectsBefore", $subjects)}

        #set($keys = [])
        #set($uriList = [])

    		#foreach($subject in $subjects)
          #set($map = {})
          #set($uri = $util.str.toUpper($util.defaultIfNullOrBlank($subject.uri, "")))
          #if ( $uri != ""  && !$uriList.contains($uri) )
            $util.qr($uriList.add($uri))
            $util.qr($map.put("PK", $util.dynamodb.toString("SUBJECTTERM")))
            $util.qr($map.put("SK", $util.dynamodb.toString("URI#$uri")))
            $util.qr($keys.add($map))
          #end
		    #end

        $!{ctx.stash.put("uriList", $uriList)}

        ## This is stupid, but I can't figure how else to skip the query and not error
        #if ( $keys != [] )
              $!{ctx.stash.put("queryAttempted", 1)}
            #else
              $!{ctx.stash.put("queryAttempted", 0)}
              #set($map = {})
              $util.qr($map.put("PK", $util.dynamodb.toString("NoKeyToFind")))
              $util.qr($map.put("SK", $util.dynamodb.toString("YieldEmptyResultSet")))
              $util.qr($keys.add($map))
        #end

        ## Query all records based on the primary key

        {
            "version" : "2017-02-28",
            "operation" : "BatchGetItem",
            "tables": {
              "${websiteMetadataTable.tableName}": {
                "keys": $util.toJson($keys),
                "consistentRead": true
              },
            },
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        ## Raise a GraphQL field error in case of a datasource invocation error
        #if($ctx.error)
            $util.error($ctx.error.message, $ctx.error.type)
        #end
        ## Pass back the result from DynamoDB. **
        ### Add extra processing here to try to generate a single record of output

        #set($subjectsAfter = [])
        ## First, add subjects from database query - only if we actually queried something
        #if ( $ctx.stash.queryAttempted == 1)
          #foreach($item in $context.result.data.${websiteMetadataTable.tableName})
            #set($map = {})
            #foreach( $entry in $util.map.copyAndRemoveAllKeys($item, ["PK","SK","TYPE","GSI1PK","GSI1SK","GSI2PK","GSI2SK","dateAddedToDynamo","dateModifiedInDynamo"]).entrySet() )
              ## $!{results.put("$entry.key", "$entry.value")}
              #set($map[$entry.key] = $entry.value)
            #end
            $util.qr($subjectsAfter.add($map))
          #end
        #end

        ## Next, add in subjects that were not found in the query
        #foreach($subject in $ctx.stash.subjectsBefore)
          #if ( $util.defaultIfNullOrBlank($subject.uri, "") == "")
            $util.qr($subjectsAfter.add($subject))
          #else
            #set($subjectInAfterList = 0)
            #set($uriToFind = $util.str.toUpper($util.defaultIfNullOrBlank($subject.uri, "")))
            #foreach($subjectAfter in $ctx.stash.subjectsAfter)
              #if ( $uriToFind == $util.str.toUpper($util.defaultIfNullOrBlank($subjectAfter.uri, "")) )
                #set($subjectInAfterList = 1)
              #end
              #if ( $subjectInAfterList == 0 )
                $util.qr($subjectsAfter.add($subject))
              #end
            #end
          #end
        #end

        ## Finally, replace existing subjects in record with new replacements
        #set($itemRecord = $ctx.stash.itemRecord)
        ## $!{itemRecord.put("subjects", $subjectsAfter)}
        #set($itemRecord["subjects"] = $subjectsAfter)
        ## $!{ctx.stash.put("subjectsAfter", $subjectsAfter)}
        $util.toJson($itemRecord)
      `),
    })

    const findPortfolioContentForUserFunction = new AppsyncFunction(this, 'FindPortfolioContentForUserFunction', {
      api: this.api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'findPortfolioContentForUserFunction',
      description: 'Used to find all Portfolio-related content for a user (or user collection) from DynamoDB.',
      requestMappingTemplate: MappingTemplate.fromString(`
        #######################################
        ## This function accepts a stashed portfolioUserId and portfolioCollectionId
        ## It do a execute a Dynamo query to find all matching items.  A subsequent step will be used to delete those matching items.
        #######################################

        #set($portfolioUserId = $ctx.stash.portfolioUserId)
        #set($portfolioUserId = $util.defaultIfNullOrBlank($portfolioUserId, ""))
        #set($portfolioUserId = $util.str.toUpper($portfolioUserId))
        #set($portfolioUserId = $util.str.toReplace($portfolioUserId, " ", ""))
        #set($portfolioCollectionId = $ctx.stash.portfolioCollectionId)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))
        #set($pk = "PORTFOLIO")
        #if( $portfolioCollectionId == "" )
          #set($sk = "USER#$portfolioUserId")
        #else
          #set($sk = "USER#$portfolioUserId#$portfolioCollectionId")
        #end
        ## Query all records based on the primary key

        $!{ctx.stash.put("findPortfolioContentForUserFunctionPk", $pk)}
        $!{ctx.stash.put("findPortfolioContentForUserFunctionSk", $sk)}

        ## Note:  This may eventually cause a problem if more than 1MB  is returned.  I wanted to use a projectionExpression, but this is not supported in AppSync.  https://github.com/aws/aws-appsync-community/issues/138
        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query": {
              "expression": "PK = :pk and begins_with(SK, :beginsWith)",
              "expressionValues": {
                ":pk": $util.dynamodb.toDynamoDBJson($pk),
                ":beginsWith": $util.dynamodb.toDynamoDBJson($sk),
              },
            },
        }`),

      responseMappingTemplate: MappingTemplate.fromString(`
        ## Raise a GraphQL field error in case of a datasource invocation error
        #if($ctx.error)
            $util.error($ctx.error.message, $ctx.error.type)
        #end
        $!{ctx.stash.put("portfolioRecordsToDelete", $ctx.result.items)}
        {
          "items": $util.toJson($ctx.result.items),
        }`),
    })
    const deletePortfolioContentForUserFunction = new AppsyncFunction(this, 'DeletePortfolioContentForUserFunction', {
      api: this.api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'deletePortfolioContentForUserFunction',
      description: 'Used to delete all Portfolio-related content for a user (or user collection) that was found in findPortfolioContentForUserFunction',
      requestMappingTemplate: MappingTemplate.fromString(`
        #######################################
        ## This function accepts a stashed portfolioRecordsToDelete, and then deletes each entry from DynamoDB
        #######################################

        #set($portfolioRecordsToDelete = $ctx.stash.portfolioRecordsToDelete)
        #set($keys = [])
        #set($recordsCountToDelete = 0)

        #foreach( $entry in $portfolioRecordsToDelete )
          #set($map = {})
          $util.qr($map.put("PK", $util.dynamodb.toString($entry.PK)))
          $util.qr($map.put("SK", $util.dynamodb.toString($entry.SK)))
          $util.qr($keys.add($map))
          #set($recordsCountToDelete = $recordsCountToDelete + 1)
        #end

        $!{ctx.stash.put("recordsCountToDelete", $recordsCountToDelete)}

        ## This is stupid, but I can't figure how else to skip the query and not error
        #if ( $keys != [] )
          $!{ctx.stash.put("queryAttempted", 1)}
        #else
          $!{ctx.stash.put("queryAttempted", 0)}
          #set($map = {})
          $util.qr($map.put("PK", $util.dynamodb.toString("NoKeyToFind")))
          $util.qr($map.put("SK", $util.dynamodb.toString("YieldEmptyResultSet")))
          $util.qr($keys.add($map))
        #end

        $!{ctx.stash.put("deletePortfolioContentForUserFunctionKeys", $keys)}

        {
          "version" : "2017-02-28",
          "operation" : "BatchDeleteItem",
          "tables": {
            "${websiteMetadataTable.tableName}": $util.toJson($keys)
          },
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        ## Raise a GraphQL field error in case of a datasource invocation error
        #if($ctx.error)
            $util.error($ctx.error.message, $ctx.error.type)
        #end
        {
          "recordsDeleted": $util.toJson($ctx.stash.recordsCountToDelete),
        }`),
    })

    new Resolver(this, 'QueryShowItemByWebsite', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'showItemByWebsite',
      pipelineConfig: [getMergedItemRecordFunction, expandSubjectTermsFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.args.websiteId)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    const saveFileToProcessRecordFunction = new AppsyncFunction(this, 'SaveFileToProcessRecordFunction', {
      api: this.api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'saveFileToProcessRecordFunction',
      description: 'Used to save FileToProcess record in DynamoDB.',
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($itemId = $ctx.stash.itemId)
        #set($height = $ctx.stash.height)
        #set($width = $ctx.stash.width)
        #set($itemId = $util.defaultIfNullOrBlank($itemId, ""))
        #set($itemId = $util.str.toUpper($itemId))
        #set($itemId = $util.str.toReplace($itemId, " ", ""))
        #set($pk = "FILETOPROCESS")
        #set($sk = "FILEPATH#$itemId")
        #set($dateLastProcessed = $util.time.nowISO8601())
        #set($GSI2SK = "DATELASTPROCESSED#$dateLastProcessed")

        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            "expression": "SET dateLastProcessed = :dateLastProcessed, dateModifiedInDynamo = :dateModifiedInDynamo, GSI2PK = :GSI2PK, GSI2SK = :GSI2SK, height = :height, width = :width",
            "expressionValues": {
              ":dateLastProcessed": $util.dynamodb.toDynamoDBJson($dateLastProcessed),
              ":dateModifiedInDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
              ":GSI2PK": $util.dynamodb.toDynamoDBJson("FILETOPROCESS"),
              ":GSI2SK": $util.dynamodb.toDynamoDBJson($GSI2SK),
              ":height": $util.dynamodb.toDynamoDBJson($height),
              ":width": $util.dynamodb.toDynamoDBJson($width),
            }
          }
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        ## Raise a GraphQL field error in case of a datasource invocation error
        #if($ctx.error)
            $util.error($ctx.error.message, $ctx.error.type)
        #end
        ## Pass back the result from DynamoDB. **
        $util.toJson($ctx.result)`),
    })

    const updateImageRecordFunction = new AppsyncFunction(this, 'UpdateImageRecordFunction', {
      api: this.api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'updateImageRecordFunction',
      description: 'Used to update width and height in the Image record in DynamoDB.',
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($itemId = $ctx.stash.itemId)
        #set($height = $ctx.stash.height)
        #set($width = $ctx.stash.width)
        #set($itemId = $util.defaultIfNullOrBlank($itemId, ""))
        #set($itemId = $util.str.toUpper($itemId))
        #set($itemId = $util.str.toReplace($itemId, " ", ""))
        #set($pk = "IMAGE")
        #set($sk = "IMAGE#$itemId")

        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            "expression": "SET height = :height, width = :width",
            "expressionValues": {
              ":height": $util.dynamodb.toDynamoDBJson($height),
              ":width": $util.dynamodb.toDynamoDBJson($width),
            }
          }
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        ## Raise a GraphQL field error in case of a datasource invocation error
        #if($ctx.error)
            $util.error($ctx.error.message, $ctx.error.type)
        #end
        ## Pass back the result from DynamoDB. **
        $util.toJson($ctx.result)`),
    })

    const updateSupplementalDataRecordFunction = new AppsyncFunction(this, 'UpdateSupplementalDataRecordFunction', {
      api: this.api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'updateSupplementalDataRecordFunction',
      description: 'Used to update a SupplementalData record in DynamoDB.',
      requestMappingTemplate: MappingTemplate.fromString(`
        #######################################
        ## This function saves the SupplementalData record with which to enhance the associated item record
        ## websiteId will default to All if not specified
        ## itemId cannot be null, websiteId may be null, other arguments are optional
        ## all will be pulled from $ctx.stash.supplementalDataArgs
        #######################################

        #set($args = $ctx.stash.supplementalDataArgs)
        #set($id = $args.itemId)
        #set($websiteId = $args.websiteId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($idNotUpper = $id)
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))

        #set($websiteId = $util.defaultIfNullOrBlank($websiteId, "All"))
        #set($websiteIdNotUpper = $websiteId)
        #set($websiteId = $util.str.toUpper($websiteId))
        #set($websiteId = $util.str.toReplace($websiteId, " ", ""))


        #set($pk = "ITEM#$id")
        #set($sk = "SUPPLEMENTALDATA#$websiteId")
        #set($args = $ctx.stash.supplementalDataArgs)
        $!{args.put('TYPE', 'SupplementalData')}
        $!{args.put('dateModifiedInDynamo', $util.time.nowISO8601())}
        $!{args.put('GSI1PK', "SUPPLEMENTALDATA")}
        $!{args.put('GSI1SK', "ITEM#$id")}
        $!{args.put('id', $idNotUpper)}
        ## since $args.websiteId already exists, the next line will echo the output, which causes an error
        ## $!{args.put('websiteId', $websiteIdNotUpper)}
        ## I will attempt the following to suppress this echo behaviour
        #set($args.websiteId = $websiteIdNotUpper)

        {
            "version" : "2017-02-28",
            "operation" : "UpdateItem",
            "key" : {
                "PK" : $util.dynamodb.toDynamoDBJson($pk),
                "SK" : $util.dynamodb.toDynamoDBJson($sk),
            },

            ## Set up some space to keep track of things we're updating **
            #set( $expNames  = {} )
            #set( $expValues = {} )
            #set( $expSet = {} )
            #set( $expAdd = {} )
            #set( $expRemove = [] )

            ## Commenting this out since we don't want to do this, but want to retain the concept for the future
            ## Increment "version" by 1 **
            ## $!{expAdd.put("version", ":one")}
            ## $!{expValues.put(":one", $util.dynamodb.toDynamoDB(1))}

            ## Iterate through each argument, skipping "id" and "expectedVersion" **
            #foreach( $entry in $util.map.copyAndRemoveAllKeys($args, ["itemId","expectedVersion"]).entrySet() )
                #if( $util.isNull($entry.value) )
                    ## If the argument is set to "null", then remove that attribute from the item in DynamoDB **

                    #set( $discard = $expRemove.add("#$entry.key") )
                    $!{expNames.put("#$entry.key", "$entry.key")}
                #else
                    ## Otherwise set (or update) the attribute on the item in DynamoDB **

                    $!{expSet.put("#$entry.key", ":$entry.key")}
                    $!{expNames.put("#$entry.key", "$entry.key")}
                    $!{expValues.put(":$entry.key", $util.dynamodb.toDynamoDB($entry.value))}
                #end
            #end

            ## Start building the update expression, starting with attributes we're going to SET **
            #set( $expression = "" )
            #if( !$expSet.isEmpty() )
                #set( $expression = "SET" )
                #foreach( $entry in $expSet.entrySet() )
                    #set( $expression = "$expression $entry.key = $entry.value" )
                    #if ( $foreach.hasNext )
                        #set( $expression = "$expression," )
                    #end
                #end
                ## Added next 2 lines in an attempt to insert dateAddedToDynamo on only the first insert
                #set( $expression = "$expression, dateAddedToDynamo = if_not_exists(dateAddedToDynamo, :dateAddedToDynamo)")
                $!{expValues.put(":dateAddedToDynamo", $util.dynamodb.toDynamoDB($util.time.nowISO8601()))}
            #end

            ## Continue building the update expression, adding attributes we're going to ADD **
            #if( !$expAdd.isEmpty() )
                #set( $expression = "$expression ADD" )
                #foreach( $entry in $expAdd.entrySet() )
                    #set( $expression = "$expression $entry.key $entry.value" )
                    #if ( $foreach.hasNext )
                        #set( $expression = "$expression," )
                    #end
                #end
            #end

            ## Continue building the update expression, adding attributes we're going to REMOVE **
            #if( !$expRemove.isEmpty() )
                #set( $expression = "$expression REMOVE" )

                #foreach( $entry in $expRemove )
                    #set( $expression = "$expression $entry" )
                    #if ( $foreach.hasNext )
                        #set( $expression = "$expression," )
                    #end
                #end
            #end

            ## Finally, write the update expression into the document, along with any expressionNames and expressionValues **
            "update" : {
                "expression" : "$expression",
                #if( !$expNames.isEmpty() )
                    "expressionNames" : $utils.toJson($expNames),
                #end
                #if( !$expValues.isEmpty() )
                    "expressionValues" : $utils.toJson($expValues),
                #end
            },
          #if($args.expectedVersion)
            "condition" : {
                "expression"       : "version = :expectedVersion",
                "expressionValues" : {
                    ":expectedVersion" : $util.dynamodb.toDynamoDBJson($args.expectedVersion)
                }
            }
            #end

        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        ## Raise a GraphQL field error in case of a datasource invocation error
        #if($ctx.error)
            $util.error($ctx.error.message, $ctx.error.type)
        #end
        ## Pass back the result from DynamoDB. **
        $util.toJson($ctx.result)`),
    })


    // Add Resolvers
    new Resolver(this, 'ImageGroupImagesResolver', {
      api: this.api,
      typeName: 'ImageGroup',
      fieldName: 'images',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.imageGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "IMAGEGROUP#$id")
        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "index" : "GSI1",
            "query" : {
                "expression": "GSI1PK = :id and begins_with(GSI1SK, :beginsWith)",
                "expressionValues" : {
                  ":id" : $util.dynamodb.toDynamoDBJson($fullId),
                  ":beginsWith": $util.dynamodb.toDynamoDBJson("SORT#"),
                }
            },
            ## Add 'limit' and 'nextToken' arguments to this field in your schema to implement pagination. **
            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
      {
          "items": $util.toJson($ctx.result.items),
          "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
      }`),
    })

    new Resolver(this, 'ImageImageGroupResolver', {
      api: this.api,
      typeName: 'Image',
      fieldName: 'imageGroup',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.imageGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "IMAGEGROUP#$id")
        {
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson("IMAGEGROUP"),
            "SK": $util.dynamodb.toDynamoDBJson($fullId),
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'ItemMetadataDefaultImageResolver', {
      api: this.api,
      typeName: 'ItemMetadata',
      fieldName: 'defaultImage',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.defaultFilePath)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))

        #set($pk = "IMAGE")
        #set($sk = "IMAGE#$id")
        {
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'ItemMetadataParentResolver', {
      api: this.api,
      typeName: 'ItemMetadata',
      fieldName: 'parent',
      pipelineConfig: [getMergedItemRecordFunction, expandSubjectTermsFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.source.parentId)}
        $!{ctx.stash.put("websiteId", $ctx.source.suppliedWebsiteId)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'ItemMetadataRootResolver', {
      api: this.api,
      typeName: 'ItemMetadata',
      fieldName: 'root',
      pipelineConfig: [getMergedItemRecordFunction, expandSubjectTermsFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        #if( $ctx.source.collectionId == $ctx.source.id )
          $!{ctx.stash.put("itemId", "someLiteralThatWeKnowWillNeverBeUsedForAnId")}
        #else
          $!{ctx.stash.put("itemId", $ctx.source.collectionId)}
        #end

        $!{ctx.stash.put("websiteId", $ctx.source.suppliedWebsiteId)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'ItemMetadataChildrenResolver', {
      api: this.api,
      typeName: 'ItemMetadata',
      fieldName: 'children',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "ITEM#$id")

        ## add stash values to enable us to eventually call GetMergedItemRecordFunction
        $!{ctx.stash.put("itemId", $ctx.source.id)}
        #if( !$util.isNull($ctx.source.suppliedWebsiteId) )
          $!{ctx.stash.put("websiteId", $ctx.source.suppliedWebsiteId)}
        #end
        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "index" : "GSI1",
            "query" : {
                ## Provide a query expression. **
                "expression": "GSI1PK = :id",
                "expressionValues" : {
                  ":id" : $util.dynamodb.toDynamoDBJson($fullId),
                }
            },

            ######### ultimately, I think I need to add suppliedWebsiteId to each record returned to propogate that down the hierarchy so the next call to getItem will have the websiteId included.

            ## Add 'limit' and 'nextToken' arguments to this field in your schema to implement pagination. **
            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        #set($results = $ctx.result)
        #set($currentRecord = 0)
        #foreach($item in $results.items)
          #set($item["suppliedWebsiteId"] = $ctx.stash.websiteId)
          #set($results.items[$currentRecord] = $item)
          #set($currentRecord = $currentRecord + 1)
        #end
        {
            "items": $util.toJson($results.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
      // responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })


    new Resolver(this, 'ItemMetadataImagesResolver', {
      api: this.api,
      typeName: 'ItemMetadata',
      fieldName: 'images',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.imageGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "IMAGEGROUP#$id")
        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "index" : "GSI1",
            "query" : {
                ## Provide a query expression. **
                "expression": "GSI1PK = :id and begins_with(GSI1SK, :beginsWith)",
                "expressionValues" : {
                  ":id" : $util.dynamodb.toDynamoDBJson($fullId),
                  ":beginsWith": $util.dynamodb.toDynamoDBJson("SORT#"),
                }
            },
            ## Add 'limit' and 'nextToken' arguments to this field in your schema to implement pagination. **
            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
    })

    new Resolver(this, 'ItemMetadataMediaResolver', {
      api: this.api,
      typeName: 'ItemMetadata',
      fieldName: 'media',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.mediaGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "MEDIAGROUP#$id")
        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "index" : "GSI1",
            "query" : {
                ## Provide a query expression. **
                "expression": "GSI1PK = :id and begins_with(GSI1SK, :beginsWith)",
                "expressionValues" : {
                  ":id" : $util.dynamodb.toDynamoDBJson($fullId),
                  ":beginsWith": $util.dynamodb.toDynamoDBJson("SORT#"),
                }
            },
            ## Add 'limit' and 'nextToken' arguments to this field in your schema to implement pagination. **
            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
    })

    new Resolver(this, 'MediaGroupMediaResolver', {
      api: this.api,
      typeName: 'MediaGroup',
      fieldName: 'media',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.mediaGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "MEDIAGROUP#$id")
        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "index" : "GSI1",
            "query" : {
                "expression": "GSI1PK = :id and begins_with(GSI1SK, :beginsWith)",
                "expressionValues" : {
                  ":id" : $util.dynamodb.toDynamoDBJson($fullId),
                  ":beginsWith": $util.dynamodb.toDynamoDBJson("SORT#"),
                }
            },
            ## Add 'limit' and 'nextToken' arguments to this field in your schema to implement pagination. **
            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
      {
          "items": $util.toJson($ctx.result.items),
          "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
      }`),
    })

    new Resolver(this, 'MediaMediaGroupResolver', {
      api: this.api,
      typeName: 'Media',
      fieldName: 'mediaGroup',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.mediaGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "MEDIAGROUP#$id")
        {
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson("MEDIAGROUP"),
            "SK": $util.dynamodb.toDynamoDBJson($fullId),
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationAddItemToWebsiteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'addItemToWebsite',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($websiteId = $ctx.args.websiteId)
        #set($websiteId = $util.defaultIfNullOrBlank($websiteId, ""))
        #set($websiteId = $util.str.toUpper($websiteId))
        #set($websiteId = $util.str.toReplace($websiteId, " ", ""))
        #set($itemId = $ctx.args.itemId)
        #set($itemId = $util.defaultIfNullOrBlank($itemId, ""))
        #set($itemId = $util.str.toUpper($itemId))
        #set($itemId = $util.str.toReplace($itemId, " ", ""))
        #set($pk = "WEBSITE#$websiteId")
        #set($sk = "ITEM#$itemId")
        #set($GSI1PK = $pk)
        #set($GSI1SK = "ADDED#$util.time.nowISO8601()")

        ## add stash values to enable us to eventually call GetMergedItemRecordFunction
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.args.websiteId)}

        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            "expression": "SET itemId = :itemId, websiteId = :websiteId, #TYPE = :rowType, dateModifiedInDynamo = :dateModifiedInDynamo, GSI1PK = :GSI1PK, GSI1SK = :GSI1SK, id = :id",
            "expressionNames": {"#TYPE": "TYPE"},
            "expressionValues": {
              ":itemId": $util.dynamodb.toDynamoDBJson($ctx.args.itemId),
              ":websiteId": $util.dynamodb.toDynamoDBJson($ctx.args.websiteId),
              ":rowType": $util.dynamodb.toDynamoDBJson("WebSiteItem"),
              ":dateModifiedInDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
              ":GSI1PK": $util.dynamodb.toDynamoDBJson($GSI1PK),
              ":GSI1SK": $util.dynamodb.toDynamoDBJson($GSI1SK),
              ":id": $util.dynamodb.toDynamoDBJson($ctx.args.itemId),
            }
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationAddItemToHarvestResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'addItemToHarvest',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($harvestItemId = $ctx.args.harvestItemId)
        #set($harvestItemId = $util.defaultIfNullOrBlank($harvestItemId, ""))
        #set($harvestItemId = $util.str.toUpper($harvestItemId))
        #set($harvestItemId = $util.str.toReplace($harvestItemId, " ", ""))
        #set($sourceSystem = $ctx.args.sourceSystem)
        #set($sourceSystem = $util.defaultIfNullOrBlank($sourceSystem, ""))
        #set($sourceSystem = $util.str.toUpper($sourceSystem))
        #set($sourceSystem = $util.str.toReplace($sourceSystem, " ", ""))
        #set($pk = "ITEMTOHARVEST")
        #set($sk = "SOURCESYSTEM#$sourceSystem#$harvestItemId")

        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            "expression": "SET harvestItemId = :harvestItemId, sourceSystem = :sourceSystem, #TYPE = :rowType, dateModifiedInDynamo = :dateModifiedInDynamo, dateAddedToDynamo = :dateAddedToDynamo",
            "expressionNames": {"#TYPE": "TYPE"},
            "expressionValues": {
              ":harvestItemId": $util.dynamodb.toDynamoDBJson($ctx.args.harvestItemId),
              ":sourceSystem": $util.dynamodb.toDynamoDBJson($ctx.args.sourceSystem),
              ":rowType": $util.dynamodb.toDynamoDBJson("ItemToHarvest"),
              ":dateModifiedInDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
              ":dateAddedToDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
            }
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })


   new Resolver(this, 'MutationBlessPortfolioCollectionResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'blessPortfolioCollection',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #if($ctx.identity.claims.netid == "dwolfe2")
          #set($netid = $util.defaultIfNullOrBlank($netid, ""))
          #set($portfolioCollectionId = $util.defaultIfNullOrBlank($ctx.args.portfolioCollectionId, $util.autoId()))
          #set($portfolioCollectionId = $util.defaultIfNullOrBlank($portfolioCollectionId, ""))
          #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
          #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))

          #set($privacy = $util.defaultIfNullOrBlank($ctx.args.privacy, "private"))
          #if( $util.isBoolean($ctx.args.featuredCollection) )
            #set($featuredCollection = $ctx.args.featuredCollection)
          #else
            #set($featuredCollection = false)
          #end
          #if( $util.isBoolean($ctx.args.highlightedCollection) )
            #set($highlightedCollection = $ctx.args.highlightedCollection)
          #else
            #set($highlightedCollection = false)
          #end

          #if( $privacy != "public")
            #set($featuredCollection = false)
            #set($highlightedCollection = false)
          #end

          #set($layout = $util.defaultIfNullOrBlank($ctx.args.layout, "default"))

          #set($title = $util.defaultIfNullOrBlank($ctx.args.title, $null))

          #set($pk = "PORTFOLIO")
          #set($sk = $util.str.toUpper("USER#$portfolioUserId#$portfolioCollectionId"))

          #set( $expValues = {})
          $!{expValues.put(":portfolioCollectionId", $util.dynamodb.toDynamoDB($portfolioCollectionId))}
          $!{expValues.put(":portfolioUserId", $util.dynamodb.toDynamoDB($portfolioUserId))}
          $!{expValues.put(":rowType", $util.dynamodb.toDynamoDB("PortfolioCollection"))}
          $!{expValues.put(":dateAddedToDynamo", $util.dynamodb.toDynamoDB($util.time.nowISO8601()))}
          $!{expValues.put(":dateModifiedInDynamo", $util.dynamodb.toDynamoDB($util.time.nowISO8601()))
          $!{expValues.put(":featuredCollection", $util.dynamodb.toDynamoDB($featuredCollection))}
          $!{expValues.put(":highlightedCollection", $util.dynamodb.toDynamoDB($highlightedCollection))}
          $!{expValues.put(":privacy", $util.dynamodb.toDynamoDB($privacy))}
          $!{expValues.put(":GSI1PK", $util.dynamodb.toDynamoDB("PORTFOLIOCOLLECTION"))}
          $!{expValues.put(":GSI1SK", $util.dynamodb.toDynamoDB("PORTFOLIOCOLLECTION#$portfolioCollectionId"))}

          #if( $privacy == "private" )
            #set($GSI2PK = "")
            #set($GSI2SK = "")
          #else
            #set($GSI2PK = "PORTFOLIOCOLLECTION")
            #set($GSI2SK = $util.str.toUpper("$privacy#$portfolioCollectionId"))

            $!{expValues.put(":GSI2PK", $util.dynamodb.toDynamoDB($GSI2PK))}
            $!{expValues.put(":GSI2SK", $util.dynamodb.toDynamoDB($GSI2SK))}
          #end

          {
            "version": "2017-02-28",
            "operation": "UpdateItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson($pk),
              "SK": $util.dynamodb.toDynamoDBJson($sk),
            },
            "update": {
              #if( $privacy == "private" )
              "expression": "SET portfolioCollectionId = :portfolioCollectionId, portfolioUserId = :portfolioUserId, #TYPE = :rowType, dateAddedToDynamo = if_not_exists(dateAddedToDynamo, :dateAddedToDynamo), dateModifiedInDynamo = :dateModifiedInDynamo, featuredCollection = :featuredCollection, highlightedCollection = :highlightedCollection, privacy = :privacy,  GSI1PK = :GSI1PK, GSI1SK = :GSI1SK REMOVE GSI2PK, GSI2SK",
              #else
                "expression": "SET portfolioCollectionId = :portfolioCollectionId, portfolioUserId = :portfolioUserId, #TYPE = :rowType, dateAddedToDynamo = if_not_exists(dateAddedToDynamo, :dateAddedToDynamo), dateModifiedInDynamo = :dateModifiedInDynamo, featuredCollection = :featuredCollection, highlightedCollection = :highlightedCollection,privacy = :privacy,GSI1PK = :GSI1PK, GSI1SK = :GSI1SK, GSI2PK = :GSI2PK, GSI2SK = :GSI2SK",
              #end
              "expressionNames": {"#TYPE": "TYPE"},
              "expressionValues":{
                ":featuredCollection" : $util.dynamodb.toDynamoDBJson($ctx.args.featuredCollection),
                ":highlightedCollection" : $util.dynamodb.toDynamoDBJson($ctx.args.highlightedCollection),
                ":privacy" : $util.dynamodb.toDynamoDBJson($ctx.args.privacy),
              }
            #end
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })



    new Resolver(this, 'MutationRemoveItemFromWebsiteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removeItemFromWebsite',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($websiteId = $ctx.args.websiteId)
        #set($websiteId = $util.defaultIfNullOrBlank($websiteId, ""))
        #set($websiteId = $util.str.toUpper($websiteId))
        #set($websiteId = $util.str.toReplace($websiteId, " ", ""))
        #set($itemId = $ctx.args.itemId)
        #set($itemId = $util.defaultIfNullOrBlank($itemId, ""))
        #set($itemId = $util.str.toUpper($itemId))
        #set($itemId = $util.str.toReplace($itemId, " ", ""))
        #set($pk = "WEBSITE#$websiteId")
        #set($sk = "ITEM#$itemId")

        {
          "version": "2017-02-28",
          "operation": "DeleteItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationRemoveItemToProcessResolver', {
        api: this.api,
        typeName: 'Mutation',
        fieldName: 'removeItemToProcess',
        dataSource: websiteMetadataDynamoDataSource,
        requestMappingTemplate: MappingTemplate.fromString(`
          #set($itemId = $ctx.args.itemId)
          #set($itemId = $util.defaultIfNullOrBlank($itemId, ""))
          #set($itemId = $util.str.toUpper($itemId))
          #set($itemId = $util.str.toReplace($itemId, " ", ""))
          #set($pk = "FILETOPROCESS")
          #set($sk = "FILEPATH#$itemId")
  
          {
            "version": "2017-02-28",
            "operation": "DeleteItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson($pk),
              "SK": $util.dynamodb.toDynamoDBJson($sk),
            }
          }`),
        responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationRemoveDefaultImageForWebsiteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removeDefaultImageForWebsite',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($itemId = $ctx.args.itemId)
        #set($itemId = $util.defaultIfNullOrBlank($itemId, ""))
        #set($itemId = $util.str.toUpper($itemId))
        #set($itemId = $util.str.toReplace($itemId, " ", ""))

        #set($websiteId = $ctx.args.websiteId)
        #set($websiteId = $util.defaultIfNullOrBlank($websiteId, "All"))
        #set($websiteId = $util.str.toUpper($websiteId))
        #set($websiteId = $util.str.toReplace($websiteId, " ", ""))


        #set($pk = "ITEM#$itemId")
        #set($sk = "SUPPLEMENTALDATA#$websiteId")


        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            "expression": "Remove defaultFilePath, objectFileGroupId, imageGroupId",
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationRemoveMediaGroupForWebsiteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removeMediaGroupForWebsite',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($itemId = $ctx.args.itemId)
        #set($itemId = $util.defaultIfNullOrBlank($itemId, ""))
        #set($itemId = $util.str.toUpper($itemId))
        #set($itemId = $util.str.toReplace($itemId, " ", ""))

        #set($websiteId = $ctx.args.websiteId)
        #set($websiteId = $util.defaultIfNullOrBlank($websiteId, "All"))
        #set($websiteId = $util.str.toUpper($websiteId))
        #set($websiteId = $util.str.toReplace($websiteId, " ", ""))


        #set($pk = "ITEM#$itemId")
        #set($sk = "SUPPLEMENTALDATA#$websiteId")


        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            "expression": "Remove mediaGroupId",
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationRemovePortfolioCollectionResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removePortfolioCollection',
      // dataSource: websiteMetadataDynamoDataSource,
      pipelineConfig: [findPortfolioContentForUserFunction, deletePortfolioContentForUserFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.identity.claims.netid)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($ctx.args.portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))

        $!{ctx.stash.put("identity", $ctx.identity)}
        $!{ctx.stash.put("portfolioUserId", $portfolioUserId)}
        $!{ctx.stash.put("portfolioCollectionId", $portfolioCollectionId)}
        {}
        `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationRemovePortfolioItemResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removePortfolioItem',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.identity.claims.netid)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($ctx.args.portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))
        #set($portfolioItemId = $util.defaultIfNullOrBlank($ctx.args.portfolioItemId, ""))
        #set($portfolioItemId = $util.str.toUpper($portfolioItemId))
        #set($portfolioItemId = $util.str.toReplace($portfolioItemId, " ", ""))

        #set($pk = "PORTFOLIO")
        #set($sk = "USER#$util.str.toUpper($portfolioUserId)#$portfolioCollectionId#$portfolioItemId")
        ## We may eventually need to do a BatchGetItem to get all items for a collection, then delete those along with a collection

        {
          "version": "2017-02-28",
          "operation": "DeleteItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationRemovePortfolioUserResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'removePortfolioUser',
      // dataSource: websiteMetadataDynamoDataSource,
      pipelineConfig: [findPortfolioContentForUserFunction, deletePortfolioContentForUserFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.identity.claims.netid)

        $!{ctx.stash.put("identity", $ctx.identity)}
        $!{ctx.stash.put("portfolioUserId", $portfolioUserId)}
        $!{ctx.stash.put("portfolioCollectionId", "")}
        {}
        `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSaveCopyrightForWebsiteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'saveCopyrightForWebsite',
      pipelineConfig: [updateSupplementalDataRecordFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.args.websiteId)}
        #set($supplementalDataArgs = {})
        $!{supplementalDataArgs.put('itemId', $ctx.args.itemId)}
        $!{supplementalDataArgs.put('websiteId', $ctx.args.websiteId)}

        ## note:  $null is an undefined variable, which has the effect of assigning null to our variable
        #set($copyrightStatemnt = $util.defaultIfNullOrBlank($ctx.args.copyrightStatement, $null))
        $!{supplementalDataArgs.put('copyrightStatement', $copyrightStatemnt)}

        ## removed when I made inCopyright optional
        ## set copyrightStatus based on inCopyright boolean
        ## #set($copyrightStatus = 'Copyright')
        ## #if(!$ctx.args.inCopyright)
        ##   #set($copyrightStatus = 'not in copyright')
        ## #end

        ## note: I added copyrightStatus as a parameter when I made inCopyright optional
        #set($copyrightStatus = $util.defaultIfNullOrBlank($ctx.args.copyrightStatus, 'not in copyright'))

        #set($additionalNotes = $util.defaultIfNullOrBlank($ctx.args.additionalNotes, $null))
        $!{supplementalDataArgs.put('additionalNotes', $additionalNotes)}
        #set($copyrightUrl = $util.defaultIfNullOrBlank($ctx.args.copyrightUrl, $null))
        $!{supplementalDataArgs.put('copyrightUrl', $copyrightUrl)}


        $!{supplementalDataArgs.put('copyrightStatus', $copyrightStatus)}
        $!{supplementalDataArgs.put('inCopyright', $ctx.args.inCopyright)}
        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}

        {}
      `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSaveDefaultImageForWebsiteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'saveDefaultImageForWebsite',
      pipelineConfig: [updateSupplementalDataRecordFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.args.websiteId)}
        #set($supplementalDataArgs = {})
        $!{supplementalDataArgs.put('itemId', $ctx.args.itemId)}
        $!{supplementalDataArgs.put('websiteId', $ctx.args.websiteId)}

        ## note:  $null is an undefined variable, which has the effect of assigning null to our variable
        #set($defaultFilePath = $util.defaultIfNullOrBlank($ctx.args.defaultFilePath, $null))
        #set($imageGroupId = $util.defaultIfNullOrBlank($ctx.args.imageGroupId, $null))
        $!{supplementalDataArgs.put('defaultFilePath', $defaultFilePath)}
        $!{supplementalDataArgs.put('imageGroupId', $imageGroupId)}

        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}

        {}
      `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSaveFileLastProcessedDateResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'saveFileLastProcessedDate',
      pipelineConfig: [updateImageRecordFunction, saveFileToProcessRecordFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("height", $ctx.args.height)}
        $!{ctx.stash.put("width", $ctx.args.width)}
        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSaveMediaGroupForWebsiteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'saveMediaGroupForWebsite',
      pipelineConfig: [updateSupplementalDataRecordFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.args.websiteId)}
        #set($supplementalDataArgs = {})
        $!{supplementalDataArgs.put('itemId', $ctx.args.itemId)}
        $!{supplementalDataArgs.put('websiteId', $ctx.args.websiteId)}

        $!{supplementalDataArgs.put('mediaGroupId', $ctx.args.mediaGroupId)}

        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}

        {}
      `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSavePartiallyDigitizedForWebsiteResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'savePartiallyDigitizedForWebsite',
      pipelineConfig: [updateSupplementalDataRecordFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.args.websiteId)}
        #set($supplementalDataArgs = {})
        $!{supplementalDataArgs.put('itemId', $ctx.args.itemId)}
        $!{supplementalDataArgs.put('websiteId', $ctx.args.websiteId)}

        $!{supplementalDataArgs.put('partiallyDigitized', $ctx.args.partiallyDigitized)}

        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}

        {}
      `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSavePortfolioCollectionResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'savePortfolioCollection',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.identity.claims.netid)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($ctx.args.portfolioCollectionId, $util.autoId()))
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))

        #set($privacy = $util.defaultIfNullOrBlank($ctx.args.privacy, "private"))
        #if( $util.isBoolean($ctx.args.featuredCollection) )
          #set($featuredCollection = $ctx.args.featuredCollection)
        #else
          #set($featuredCollection = false)
        #end
        #if( $util.isBoolean($ctx.args.highlightedCollection) )
          #set($highlightedCollection = $ctx.args.highlightedCollection)
        #else
          #set($highlightedCollection = false)
        #end

        #if( $privacy != "public")
          #set($featuredCollection = false)
          #set($highlightedCollection = false)
        #end

        #set($layout = $util.defaultIfNullOrBlank($ctx.args.layout, "default"))

        #set($title = $util.defaultIfNullOrBlank($ctx.args.title, $null))

        #set($pk = "PORTFOLIO")
        #set($sk = $util.str.toUpper("USER#$portfolioUserId#$portfolioCollectionId"))

        #set( $expValues = {})
        $!{expValues.put(":portfolioCollectionId", $util.dynamodb.toDynamoDB($portfolioCollectionId))}
        $!{expValues.put(":portfolioUserId", $util.dynamodb.toDynamoDB($portfolioUserId))}
        $!{expValues.put(":rowType", $util.dynamodb.toDynamoDB("PortfolioCollection"))}
        $!{expValues.put(":dateAddedToDynamo", $util.dynamodb.toDynamoDB($util.time.nowISO8601()))}
        $!{expValues.put(":dateModifiedInDynamo", $util.dynamodb.toDynamoDB($util.time.nowISO8601()))}
        $!{expValues.put(":description", $util.dynamodb.toDynamoDB($ctx.args.description))}
        $!{expValues.put(":imageUri", $util.dynamodb.toDynamoDB($ctx.args.imageUri))}
        $!{expValues.put(":featuredCollection", $util.dynamodb.toDynamoDB($featuredCollection))}
        $!{expValues.put(":highlightedCollection", $util.dynamodb.toDynamoDB($highlightedCollection))}
        $!{expValues.put(":layout", $util.dynamodb.toDynamoDB($layout))}
        $!{expValues.put(":title", $util.dynamodb.toDynamoDB($title))}
        $!{expValues.put(":privacy", $util.dynamodb.toDynamoDB($privacy))}
        $!{expValues.put(":GSI1PK", $util.dynamodb.toDynamoDB("PORTFOLIOCOLLECTION"))}
        $!{expValues.put(":GSI1SK", $util.dynamodb.toDynamoDB("PORTFOLIOCOLLECTION#$portfolioCollectionId"))}

        #if( $privacy == "private" )
          #set($GSI2PK = "")
          #set($GSI2SK = "")
        #else
          #set($GSI2PK = "PORTFOLIOCOLLECTION")
          #set($GSI2SK = $util.str.toUpper("$privacy#$portfolioCollectionId"))

          $!{expValues.put(":GSI2PK", $util.dynamodb.toDynamoDB($GSI2PK))}
          $!{expValues.put(":GSI2SK", $util.dynamodb.toDynamoDB($GSI2SK))}
        #end

        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            #if( $privacy == "private" )
            "expression": "SET portfolioCollectionId = :portfolioCollectionId, portfolioUserId = :portfolioUserId, #TYPE = :rowType, dateAddedToDynamo = if_not_exists(dateAddedToDynamo, :dateAddedToDynamo), dateModifiedInDynamo = :dateModifiedInDynamo, description = :description, imageUri = :imageUri, featuredCollection = :featuredCollection, highlightedCollection = :highlightedCollection, layout = :layout, privacy = :privacy, title = :title, GSI1PK = :GSI1PK, GSI1SK = :GSI1SK REMOVE GSI2PK, GSI2SK",
            #else
              "expression": "SET portfolioCollectionId = :portfolioCollectionId, portfolioUserId = :portfolioUserId, #TYPE = :rowType, dateAddedToDynamo = if_not_exists(dateAddedToDynamo, :dateAddedToDynamo), dateModifiedInDynamo = :dateModifiedInDynamo, description = :description, imageUri = :imageUri, featuredCollection = :featuredCollection, highlightedCollection = :highlightedCollection, layout = :layout, privacy = :privacy, title = :title, GSI1PK = :GSI1PK, GSI1SK = :GSI1SK, GSI2PK = :GSI2PK, GSI2SK = :GSI2SK",
            #end
            "expressionNames": {"#TYPE": "TYPE"},
            "expressionValues": $util.toJson($expValues)
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSavePortfolioItemResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'savePortfolioItem',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.identity.claims.netid)
        #set($portfolioCollectionId = $ctx.args.portfolioCollectionId)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))

        #set($portfolioItemId = $util.defaultIfNullOrBlank($ctx.args.portfolioItemId, $ctx.args.internalItemId))
        #set($originalPortfolioItemId = $portfolioItemId)
        #set($portfolioItemId = $util.defaultIfNullOrBlank($portfolioItemId, $ctx.args.uri))
        #set($portfolioItemId = $util.defaultIfNullOrBlank($portfolioItemId, $util.autoId()))

        #set($itemType = $util.defaultIfNullOrBlank($ctx.args.itemType, "internal"))

        #set($pk = "PORTFOLIO")
        #set($sk = $util.str.toUpper("USER#$portfolioUserId#$portfolioCollectionId#$portfolioItemId"))

        #set( $expValues = {})
        $!{expValues.put(":portfolioItemId", $util.dynamodb.toDynamoDB($originalPortfolioItemId))}
        $!{expValues.put(":portfolioCollectionId", $util.dynamodb.toDynamoDB($portfolioCollectionId))}
        $!{expValues.put(":portfolioUserId", $util.dynamodb.toDynamoDB($portfolioUserId))}
        $!{expValues.put(":rowType", $util.dynamodb.toDynamoDB("PortfolioItem"))}
        $!{expValues.put(":annotation", $util.dynamodb.toDynamoDB($ctx.args.annotation))}
        $!{expValues.put(":dateAddedToDynamo", $util.dynamodb.toDynamoDB($util.time.nowISO8601()))}
        $!{expValues.put(":dateModifiedInDynamo", $util.dynamodb.toDynamoDB($util.time.nowISO8601()))}
        $!{expValues.put(":description", $util.dynamodb.toDynamoDB($ctx.args.description))}
        $!{expValues.put(":imageUri", $util.dynamodb.toDynamoDB($ctx.args.imageUri))}
        $!{expValues.put(":internalItemId", $util.dynamodb.toDynamoDB($ctx.args.internalItemId))}
        $!{expValues.put(":sequence", $util.dynamodb.toDynamoDB($ctx.args.sequence))}
        $!{expValues.put(":title", $util.dynamodb.toDynamoDB($ctx.args.title))}
        $!{expValues.put(":uri", $util.dynamodb.toDynamoDB($ctx.args.uri))}

        #if( !$util.defaultIfNullOrBlank($ctx.args.internalItemId, ""))
          #set($GSI1PK = $null)
          #set($GSI1SK = $null)
        #else
          #set($GSI1PK = "PORTFOLIOITEM")
          #set($GSI1SK = $util.str.toUpper("INTERNALITEM#$portfolioItemId"))
          $!{expValues.put(":GSI1PK", $util.dynamodb.toDynamoDB($GSI1PK))}
          $!{expValues.put(":GSI1SK", $util.dynamodb.toDynamoDB($GSI1SK))}
          #set($itemType = "internal")
        #end
        $!{expValues.put(":itemType", $util.dynamodb.toDynamoDB($itemType))}

        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            #if( !$util.defaultIfNullOrBlank($ctx.args.internalItemId, ""))
              "expression": "SET portfolioItemId = :portfolioItemId, portfolioCollectionId = :portfolioCollectionId, portfolioUserId = :portfolioUserId, #TYPE = :rowType, annotation = :annotation, dateAddedToDynamo = if_not_exists(dateAddedToDynamo, :dateAddedToDynamo), dateModifiedInDynamo = :dateModifiedInDynamo, description = :description, imageUri = :imageUri, internalItemId = :internalItemId, itemType = :itemType, #sequence = :sequence, title = :title, uri = :uri REMOVE GSI1PK, GSI1SK",
            #else
              "expression": "SET portfolioItemId = :portfolioItemId, portfolioCollectionId = :portfolioCollectionId, portfolioUserId = :portfolioUserId, #TYPE = :rowType, annotation = :annotation, dateAddedToDynamo = if_not_exists(dateAddedToDynamo, :dateAddedToDynamo), dateModifiedInDynamo = :dateModifiedInDynamo, description = :description, imageUri = :imageUri, internalItemId = :internalItemId, itemType = :itemType, #sequence = :sequence, title = :title, uri = :uri, GSI1PK = :GSI1PK, GSI1SK = :GSI1SK",
            #end
            "expressionNames": {"#TYPE": "TYPE", "#sequence": "sequence"},
            "expressionValues": $util.toJson($expValues)
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSavePortfolioUserResolver', {
      api: this.api,
      typeName: 'Mutation',
      fieldName: 'savePortfolioUser',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.identity.claims.netid)
        #set($fullName = $util.defaultIfNullOrBlank($ctx.args.fullName, $ctx.identity.claims.name))
        #set($email = $util.defaultIfNullOrBlank($ctx.args.email, $ctx.identity.claims.email))
        #set($primaryAffiliation = $ctx.identity.claims.primary_affiliation)
        #set($department = $ctx.identity.claims.department)

        $!{ctx.stash.put("identity", $ctx.identity)}
        $!{ctx.stash.put("portfolioUserId", $portfolioUserId)}
        $!{ctx.stash.put("fullName", $fullName)}
        $!{ctx.stash.put("email", $email)}
        $!{ctx.stash.put("primaryAffiliation", $primaryAffiliation)}
        $!{ctx.stash.put("department", $department)}

        #set($pk = "PORTFOLIO")
        #set($sk = "USER#$util.str.toUpper($portfolioUserId)")

        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            "expression": "SET portfolioUserId = :portfolioUserId, bio = :bio, #TYPE = :rowType, dateAddedToDynamo = if_not_exists(dateAddedToDynamo, :dateAddedToDynamo), dateModifiedInDynamo = :dateModifiedInDynamo, department = :department, email = :email, fullName = :fullName, primaryAffiliation = :primaryAffiliation",
            "expressionNames": {"#TYPE": "TYPE"},
            "expressionValues": {
              ":portfolioUserId": $util.dynamodb.toDynamoDBJson($portfolioUserId),
              ":bio": $util.dynamodb.toDynamoDBJson($ctx.args.bio),
              ":rowType": $util.dynamodb.toDynamoDBJson("PortfolioUser"),
              ":dateAddedToDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
              ":dateModifiedInDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
              ":department": $util.dynamodb.toDynamoDBJson($department),
              ":email": $util.dynamodb.toDynamoDBJson($email),
              ":fullName": $util.dynamodb.toDynamoDBJson($fullName),
              ":primaryAffiliation": $util.dynamodb.toDynamoDBJson($primaryAffiliation),
            }
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'PortfolioUserPortfolioCollectionsResolver', {
      api: this.api,
      typeName: 'PortfolioUser',
      fieldName: 'portfolioCollections',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
      #set($portfolioUserId = $ctx.source.portfolioUserId)
      #set($portfolioUserId = $util.defaultIfNullOrBlank($portfolioUserId, ""))
      #set($portfolioUserId = $util.str.toUpper($portfolioUserId))
      #set($portfolioUserId = $util.str.toReplace($portfolioUserId, " ", ""))
          #if($ctx.identity.claims && $ctx.identity.claims.netid == $ctx.source.portfolioUserId)
          	#set($expression = "#TYPE = :rowType")
          #else
          	#set($expression = "#TYPE = :rowType and not contains(privacy, :privacy)")
          #end

      {
          "version" : "2017-02-28",
          "operation" : "Query",
          "query" : {
            "expression": "PK = :pk and begins_with(SK, :beginsWith)",
            "expressionValues" : {
              ":pk": $util.dynamodb.toDynamoDBJson("PORTFOLIO"),
              ":beginsWith": $util.dynamodb.toDynamoDBJson("USER#$portfolioUserId#"),
            },
		      },
          "filter": {
            "expression": "$expression",
            "expressionValues" : {
              	":rowType": $util.dynamodb.toDynamoDBJson("PortfolioCollection"),
          #if(!($ctx.identity.claims && $ctx.identity.claims.netid == $ctx.source.portfolioUserId))
                  ":privacy": $util.dynamodb.toDynamoDBJson("private"),
          #end
              },
            "expressionNames": {"#TYPE": "TYPE"},
    			},
          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
      }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
    })

    new Resolver(this, 'PortfolioCollectionCreatorResolver', {
      api: this.api,
      typeName: 'PortfolioCollection',
      fieldName: 'creator',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.source.portfolioUserId)
        #set($portfolioUserId = $util.defaultIfNullOrBlank($portfolioUserId, ""))
        #set($portfolioUserId = $util.str.toUpper($portfolioUserId))
        #set($portfolioUserId = $util.str.toReplace($portfolioUserId, " ", ""))


        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("PORTFOLIO"),
              "SK": $util.dynamodb.toDynamoDBJson($util.str.toUpper("USER#$portfolioUserId")),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'PortfolioCollectionPortfolioItemsResolver', {
      api: this.api,
      typeName: 'PortfolioCollection',
      fieldName: 'portfolioItems',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.source.portfolioUserId)
        #set($portfolioUserId = $util.defaultIfNullOrBlank($portfolioUserId, ""))
        #set($portfolioUserId = $util.str.toUpper($portfolioUserId))
        #set($portfolioUserId = $util.str.toReplace($portfolioUserId, " ", ""))
        #set($portfolioCollectionId = $ctx.source.portfolioCollectionId)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))

        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query" : {
              "expression": "PK = :pk and begins_with(SK, :beginsWith)",
              "expressionValues" : {
                ":pk": $util.dynamodb.toDynamoDBJson("PORTFOLIO"),
                ":beginsWith": $util.dynamodb.toDynamoDBJson("USER#$portfolioUserId#$portfolioCollectionId#"),
              },
			      },
            "filter": {
              "expression": "#TYPE = :rowType",
              "expressionValues": {
                ":rowType": $util.dynamodb.toDynamoDBJson("PortfolioItem"),
              },
              "expressionNames": {"#TYPE": "TYPE"},
      			},
            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
    })

    new Resolver(this, 'QueryGetExposedPortfolioCollectionResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getExposedPortfolioCollection',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioCollectionId = $ctx.args.portfolioCollectionId)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))

        {
          "version": "2017-02-28",
          "operation": "Query",
          "index": "GSI1",
          "query" : {
            "expression": "GSI1PK = :GSI1PK and begins_with(GSI1SK, :beginsWith)",
            "expressionValues" : {
            ":GSI1PK": $util.dynamodb.toDynamoDBJson("PORTFOLIOCOLLECTION"),
              ":beginsWith": $util.dynamodb.toDynamoDBJson($util.str.toUpper("PORTFOLIOCOLLECTION#$portfolioCollectionId")),
                }
            },
          "filter": {
            "expression": "#TYPE = :rowType",
              "expressionValues": {
              ":rowType": $util.dynamodb.toDynamoDBJson("PortfolioCollection"),
                },
            "expressionNames": { "#TYPE": "TYPE" },
          },
        }`),
      // responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
      responseMappingTemplate: MappingTemplate.fromString(`
        #set($result = {})
        #if( $ctx.result.items.size() > 0 )
          #set($result = $ctx.result.items[0])
        #end

        $util.toJson($result)
        `),
    })

    new Resolver(this, 'QueryGetFileToProcessRecordResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getFileToProcessRecord',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.filePath)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "FILEPATH#$id")

        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("FILETOPROCESS"),
              "SK": $util.dynamodb.toDynamoDBJson($fullId),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetImageResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getImage',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "IMAGE#$id")

        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("IMAGE"),
                "SK": $util.dynamodb.toDynamoDBJson($fullId),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGeImageGroupResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getImageGroup',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "IMAGEGROUP#$id")

        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("IMAGEGROUP"),
                "SK": $util.dynamodb.toDynamoDBJson($fullId),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetItemResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getItem',
      pipelineConfig: [getMergedItemRecordFunction, expandSubjectTermsFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        ## add stash values to enable us to call GetMergedItemRecordFunction
        $!{ctx.stash.put("itemId", $ctx.args.id)}
        $!{ctx.stash.put("websiteId", $util.defaultIfNullOrBlank($ctx.args.websiteId, ""))}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetMediaResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getMedia',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "MEDIA#$id")

        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("MEDIA"),
                "SK": $util.dynamodb.toDynamoDBJson($fullId),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGeMediaGroupResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getMediaGroup',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "MEDIAGROUP#$id")

        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("MEDIAGROUP"),
                "SK": $util.dynamodb.toDynamoDBJson($fullId),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetPortfolioCollectionResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getPortfolioCollection',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.identity.claims.netid)
        #set($portfolioCollectionId = $ctx.args.portfolioCollectionId)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))

        {
          "version": "2017-02-28",
          "operation": "Query",
          "index": "GSI1",
          "query" : {
            "expression": "GSI1PK = :GSI1PK and GSI1SK = :GSI1SK",
            "expressionValues" : {
              ":GSI1PK": $util.dynamodb.toDynamoDBJson("PORTFOLIOCOLLECTION"),
              ":GSI1SK": $util.dynamodb.toDynamoDBJson($util.str.toUpper("PORTFOLIOCOLLECTION#$portfolioCollectionId")),
                }
            },
          "filter": {
            "expression": "#TYPE = :rowType AND (#PORTFOLIOUSERID = :portfolioUserId OR not contains(privacy, :privacy))",
              "expressionValues": {
              ":rowType": $util.dynamodb.toDynamoDBJson("PortfolioCollection"),
              ":portfolioUserId": $util.dynamodb.toDynamoDBJson($portfolioUserId),
			  ":privacy": $util.dynamodb.toDynamoDBJson("private"),
                },
            "expressionNames": { "#TYPE": "TYPE", "#PORTFOLIOUSERID": "portfolioUserId" },
          },
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        #set($result = {})
        #if( $ctx.result.items.size() > 0 )
          #set($result = $ctx.result.items[0])
        #end

        $util.toJson($result)
      `),
    })

    new Resolver(this, 'QueryGetPortfolioItemResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getPortfolioItem',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($portfolioUserId = $ctx.identity.claims.netid)
        #set($portfolioCollectionId = $ctx.args.portfolioCollectionId)
        #set($portfolioCollectionId = $util.defaultIfNullOrBlank($portfolioCollectionId, ""))
        #set($portfolioCollectionId = $util.str.toUpper($portfolioCollectionId))
        #set($portfolioCollectionId = $util.str.toReplace($portfolioCollectionId, " ", ""))

        #set($portfolioItemId = $ctx.args.portfolioItemId)
        #set($portfolioItemId = $util.defaultIfNullOrBlank($portfolioItemId, ""))
        #set($portfolioItemId = $util.str.toUpper($portfolioItemId))
        #set($portfolioItemId = $util.str.toReplace($portfolioItemId, " ", ""))

        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("PORTFOLIO"),
              "SK": $util.dynamodb.toDynamoDBJson($util.str.toUpper("USER#$portfolioUserId#$portfolioCollectionId#$portfolioItemId")),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetPortfolioUserResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getPortfolioUser',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #if ($ctx.args.portfolioUserId)
        	#set($ID = $ctx.args.portfolioUserId)
        #else
        	#set($ID = $ctx.identity.claims.netid)
        #end
        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("PORTFOLIO"),
              "SK": $util.dynamodb.toDynamoDBJson($util.str.toUpper("USER#$ID")),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetWebsiteResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'getWebsite',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "WEBSITE#$id")

        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("WEBSITE"),
              "SK": $util.dynamodb.toDynamoDBJson($fullId),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryListFilesToProcessResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listFilesToProcess',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($dateLastProcessedBefore = $ctx.args.dateLastProcessedBefore)
        #set($dateLastProcessedBefore = $util.defaultIfNullOrBlank($dateLastProcessedBefore, ""))
        #set($dateLastProcessedBefore = $util.str.toUpper($dateLastProcessedBefore))
        #set($dateLastProcessedBefore = $util.str.toReplace($dateLastProcessedBefore, " ", ""))

        #set($pk = "FILETOPROCESS")
        #set($sk = "DATELASTPROCESSED#$dateLastProcessedBefore" )
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "index": "GSI2",
          "query" : {
              "expression": "GSI2PK = :pk and GSI2SK <= :sk",
              "expressionValues" : {
                  ":pk": $util.dynamodb.toDynamoDBJson($pk),
                  ":sk": $util.dynamodb.toDynamoDBJson($sk),
              }
          },
          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'QueryListImageGroupsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listImageGroups',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        ## Note:  $null is undefined, so this results in assigning the value of null to our variable if the parameter is not passed.
        #set($storageSystem = $util.defaultIfNullOrBlank($ctx.args.storageSystem, $null))

        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query" : {
                ## Provide a query expression. **
                "expression": "PK = :id",
                "expressionValues" : {
                    ":id" : $util.dynamodb.toDynamoDBJson("IMAGEGROUP")
                }
            },
          #if ( $storageSystem != $null )
            "filter": {
              "expression": "storageSystem = :storageSystem",
              "expressionValues": {
                ":storageSystem": $util.dynamodb.toDynamoDBJson("$storageSystem"),
              }
            },
          #end

          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
    })

    new Resolver(this, 'QueryListImageGroupsForS3Resolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listImageGroupsForS3',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($storageSystem = "S3")

        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query" : {
                ## Provide a query expression. **
                "expression": "PK = :id",
                "expressionValues" : {
                    ":id" : $util.dynamodb.toDynamoDBJson("IMAGEGROUP")
                }
            },
          #if ( $storageSystem != $null )
            "filter": {
              "expression": "storageSystem = :storageSystem",
              "expressionValues": {
                ":storageSystem": $util.dynamodb.toDynamoDBJson("$storageSystem"),
              }
            },
          #end

          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'QueryListImageGroupsReferencedResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listImageGroupsReferenced',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "index": "GSI2",
          "query" : {
              ## Provide a query expression. **
              "expression": "GSI2PK = :id",
              "expressionValues" : {
                  ":id" : $util.dynamodb.toDynamoDBJson("SUPPLEMENTALDATA")
              }
            },
            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
    })


    // Note that id is really sourceSystem, which can be confusing
    new Resolver(this, 'QueryListItemsBySourceSystemResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listItemsBySourceSystem',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "SOURCESYSTEM#$id")
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "index": "GSI2",
          "query" : {
              "expression": "GSI2PK = :id and begins_with(GSI2SK, :beginsWith)",
              "expressionValues" : {
                  ":id": $util.dynamodb.toDynamoDBJson($fullId),
                  ":beginsWith": $util.dynamodb.toDynamoDBJson("SORT#"),
                }
          },
          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'QueryListItemsByWebsiteResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listItemsByWebsite',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "WEBSITE#$id")
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "query" : {
              "expression": "PK = :id",
              "expressionValues" : {
                  ":id": $util.dynamodb.toDynamoDBJson($fullId)
              }
          },
          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'QueryListMediaGroupsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listMediaGroups',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        ## Note:  $null is undefined, so this results in assigning the value of null to our variable if the parameter is not passed.
        #set($storageSystem = $util.defaultIfNullOrBlank($ctx.args.storageSystem, $null))

        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query" : {
                ## Provide a query expression. **
                "expression": "PK = :id",
                "expressionValues" : {
                    ":id" : $util.dynamodb.toDynamoDBJson("MEDIAGROUP")
                }
            },
          #if ( $storageSystem != $null )
            "filter": {
              "expression": "storageSystem = :storageSystem",
              "expressionValues": {
                ":storageSystem": $util.dynamodb.toDynamoDBJson("$storageSystem"),
              }
            },
          #end

            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
    })

    new Resolver(this, 'QueryListMediaGroupsForS3Resolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listMediaGroupsForS3',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($storageSystem = "S3")

        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query" : {
                ## Provide a query expression. **
                "expression": "PK = :id",
                "expressionValues" : {
                    ":id" : $util.dynamodb.toDynamoDBJson("MEDIAGROUP")
                }
            },
          #if ( $storageSystem != $null )
            "filter": {
              "expression": "storageSystem = :storageSystem",
              "expressionValues": {
                ":storageSystem": $util.dynamodb.toDynamoDBJson("$storageSystem"),
              }
            },
          #end

            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'QueryListMediaGroupsReferencedResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listMediaGroupsReferenced',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "index": "GSI3",
          "query" : {
              ## Provide a query expression. **
              "expression": "GSI3PK = :id",
              "expressionValues" : {
                  ":id" : $util.dynamodb.toDynamoDBJson("SUPPLEMENTALDATA")
              }
          },
          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
        }`),
    })

    new Resolver(this, 'QueryListPublicPortfolioCollectionsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listPublicPortfolioCollections',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`

        {
          "version": "2017-02-28",
          "operation": "Query",
          "index": "GSI2",
          "query" : {
            "expression": "GSI2PK = :GSI2PK and begins_with(GSI2SK, :beginsWith)",
            "expressionValues" : {
              ":GSI2PK": $util.dynamodb.toDynamoDBJson("PORTFOLIOCOLLECTION"),
              ":beginsWith": $util.dynamodb.toDynamoDBJson($util.str.toUpper("PUBLIC#")),
              }
          },
          "filter": {
            "expression": "#TYPE = :rowType and privacy = :privacy",
            "expressionValues": {
              ":rowType": $util.dynamodb.toDynamoDBJson("PortfolioCollection"),
              ":privacy": $util.dynamodb.toDynamoDBJson("public"),
            },
            "expressionNames": {"#TYPE": "TYPE"},
          },
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'QueryListPublicHighlightedPortfolioCollectionsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listPublicHighlightedPortfolioCollections',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`

        {
          "version": "2017-02-28",
          "operation": "Query",
          "index": "GSI2",
          "query" : {
            "expression": "GSI2PK = :GSI2PK and begins_with(GSI2SK, :beginsWith)",
            "expressionValues" : {
              ":GSI2PK": $util.dynamodb.toDynamoDBJson("PORTFOLIOCOLLECTION"),
              ":beginsWith": $util.dynamodb.toDynamoDBJson($util.str.toUpper("PUBLIC#")),
              }
          },
          "filter": {
            "expression": "#TYPE = :rowType and privacy = :privacy and highlightedCollection = :highlightedCollection",
            "expressionValues": {
              ":rowType": $util.dynamodb.toDynamoDBJson("PortfolioCollection"),
              ":privacy": $util.dynamodb.toDynamoDBJson("public"),
              ":highlightedCollection": $util.dynamodb.toDynamoDBJson(true),
            },
            "expressionNames": {"#TYPE": "TYPE"},
          },
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'QueryListPublicFeaturedPortfolioCollectionsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listPublicFeaturedPortfolioCollections',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`

        {
          "version": "2017-02-28",
          "operation": "Query",
          "index": "GSI2",
          "query" : {
            "expression": "GSI2PK = :GSI2PK and begins_with(GSI2SK, :beginsWith)",
            "expressionValues" : {
              ":GSI2PK": $util.dynamodb.toDynamoDBJson("PORTFOLIOCOLLECTION"),
              ":beginsWith": $util.dynamodb.toDynamoDBJson($util.str.toUpper("PUBLIC#")),
              }
            },
            "filter": {
            "expression": "#TYPE = :rowType and privacy = :privacy and featuredCollection = :featuredCollection",
            "expressionValues": {
              ":rowType": $util.dynamodb.toDynamoDBJson("PortfolioCollection"),
              ":privacy": $util.dynamodb.toDynamoDBJson("public"),
              ":featuredCollection": $util.dynamodb.toDynamoDBJson(true),
            },
            "expressionNames": {"#TYPE": "TYPE"},
          },
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })


    new Resolver(this, 'QueryListSupplementalDataRecordsResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listSupplementalDataRecords',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($websiteId = $ctx.args.websiteId)
        #set($websiteId = $util.defaultIfNullOrBlank($websiteId, ""))
        $!{ctx.stash.put("id", $id)}
        $!{ctx.stash.put("websiteId", $websiteId)}

        #set($pk = "SUPPLEMENTALDATA")
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "index" : "GSI1",
          "query" : {
              "expression": "GSI1PK = :pk",
              "expressionValues" : {
                  ":pk": $util.dynamodb.toDynamoDBJson($pk)
              }
          },
          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        ## Raise a GraphQL field error in case of a datasource invocation error
        #if($ctx.error)
            $util.error($ctx.error.message, $ctx.error.type)
        #end

        #set($id = $util.str.toUpper($ctx.stash.id))
        #set($websiteId = $util.str.toUpper($ctx.stash.websiteId))
        #set($results = [])

        #foreach($item in $context.result.items)
            ## $util.qr($results.add($item))
          #if( $id == "" && $websiteId == "")
            $util.qr($results.add($item))
          #elseif( $id != "" && $util.str.toUpper($item.id) == $id && $websiteId != "" && $util.str.toUpper($item.websiteId) == $websiteId)
            $util.qr($results.add($item))
          #elseif( $id != "" && $util.str.toUpper($item.id) == $id && $websiteId == "")
            $util.qr($results.add($item))
          #elseif( $websiteId != "" && $util.str.toUpper($item.websiteId) == $websiteId && $id == "")
            $util.qr($results.add($item))
          #end
        #end


        {
          ## "items": $util.toJson($context.result.items),
          "items": $util.toJson($results),
          "nextToken": $util.toJson($context.result.nextToken)
        }
      `),
    })

    new Resolver(this, 'QueryListWebsitesResolver', {
      api: this.api,
      typeName: 'Query',
      fieldName: 'listWebsites',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "query" : {
              ## Provide a query expression. **
              "expression": "PK = :id",
              "expressionValues" : {
                  ":id" : $util.dynamodb.toDynamoDBJson("WEBSITE")
              }
          },
          "limit": $util.defaultIfNull($ctx.args.limit, 1000),
          "nextToken": #if($context.arguments.nextToken) "$context.arguments.nextToken" #else null #end
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
          "items": $util.toJson($context.result.items),
          "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'WebsiteWebsiteItemsResolver', {
      api: this.api,
      typeName: 'Website',
      fieldName: 'websiteItems',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "WEBSITE#$id")

        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query" : {
                ## Provide a query expression. **
                "expression": "PK = :id",
                "expressionValues" : {
                    ":id" : $util.dynamodb.toDynamoDBJson($fullId)
                }
            },
            ## Add 'limit' and 'nextToken' arguments to this field in your schema to implement pagination. **
            "limit": $util.defaultIfNull($ctx.args.limit, 1000),
            "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
        }`),
      responseMappingTemplate: MappingTemplate.fromString(`
        {
            "items": $util.toJson($ctx.result.items),
            "nextToken": $util.toJson($context.result.nextToken)
        }`),
    })

    new Resolver(this, 'WebsiteItemItemMetadataResolver', {
      api: this.api,
      typeName: 'WebsiteItem',
      fieldName: 'ItemMetadata',
      pipelineConfig: [getMergedItemRecordFunction, expandSubjectTermsFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.source.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.source.websiteId)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

  }
}
