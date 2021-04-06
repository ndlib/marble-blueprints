import { Construct, Duration, Expiration, Fn, Stack, StackProps } from "@aws-cdk/core"
import { AppsyncFunction, AuthorizationType, DynamoDbDataSource, FieldLogLevel, GraphqlApi, MappingTemplate, Resolver, Schema } from '@aws-cdk/aws-appsync'
import { Rule, Schedule } from "@aws-cdk/aws-events"
import { LambdaFunction } from "@aws-cdk/aws-events-targets"
import { Effect, PolicyStatement } from '@aws-cdk/aws-iam'
import { Code, Function, Runtime } from "@aws-cdk/aws-lambda"
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
            expires: Expiration.after(Duration.days(7)),
          },
        },
      },
      xrayEnabled: true,
      logConfig: { fieldLogLevel: FieldLogLevel.ERROR },
    })

    // This will need to be populated separately
    this.graphqlApiUrlKeyPath = `/all/stacks/${this.stackName}/graphql-api-url`

    this.maintainMetadataKeyBase = `/all/stacks/${this.stackName}`

    // Save values to Parameter Store (SSM) for later reference
    new StringParameter(this, 'SSMGraphqlApiUrl', {
      type: ParameterType.STRING,
      parameterName: this.graphqlApiUrlKeyPath,
      stringValue: api.graphqlUrl,
      description: 'AppSync GraphQL base url',
    })
    
    this.graphqlApiKeyKeyPath = `/all/stacks/${this.stackName}/graphql-api-key`

    this.graphqlApiIdKeyPath = `/all/stacks/${this.stackName}/graphql-api-id`
    new StringParameter(this, 'SSMGraphqlApiId', {
      type: ParameterType.STRING,
      parameterName: this.graphqlApiIdKeyPath,
      stringValue: api.apiId,
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
`),
      description: 'Rotates API Keys for AppSync - Maintain Metadata',
      handler: 'index.run',
      runtime: Runtime.PYTHON_3_8,
      environment: {
        GRAPHQL_API_ID_KEY_PATH: this.graphqlApiIdKeyPath,
        GRAPHQL_API_KEY_KEY_PATH: this.graphqlApiKeyKeyPath,
        DAYS_FOR_KEY_TO_LAST: "2",
      },
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'appsync:CreateApiKey',
          ],
          resources: [
            Fn.sub('arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:/v1/apis/') + api.apiId + '/apikeys',

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
      api: api,
      table: websiteMetadataTable,
      readOnlyAccess: false,
    })


    // Add Functions
    const getMergedItemRecordFunction = new AppsyncFunction(this, 'GetMergedItemRecordFunction', {
      api: api,
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
      api: api,
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

    new Resolver(this, 'QueryShowItemByWebsite', {
      api: api,
      typeName: 'Query',
      fieldName: 'showItemByWebsite',
      pipelineConfig: [getMergedItemRecordFunction, expandSubjectTermsFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.args.websiteId)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    const updateSupplementalDataRecordFunction = new AppsyncFunction(this, 'UpdateSupplementalDataRecordFunction', {
      api: api,
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
        $!{args.put('title', $idNotUpper)}

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


    // Remove once Red Box is updated to use new save...ForWebsite mutations
    const updateItemFunction = new AppsyncFunction(this, 'UpdateItemFunction', {
      api: api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'updateItemFunction',
      description: 'Used to update an Item record in DynamoDB.',
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.stash.itemId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($pk = "ITEM#$id")
        #set($sk = "ITEM#$id")
        #set($args = $ctx.stash.itemArgs)
        $!{args.put('TYPE', 'Item')}
        $!{args.put('dateModifiedInDynamo', $util.time.nowISO8601())}

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

    // Remove once Red Box is updated to use new save...ForWebsite mutations
    const updateSupplementalDataFunction = new AppsyncFunction(this, 'UpdateSupplementalDataFunction', {
      api: api,
      dataSource: websiteMetadataDynamoDataSource,
      name: 'updateSupplementalDataFunction',
      description: 'Used to update a SupplementalData record in DynamoDB.',
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.stash.itemId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($pk = "ITEM#$id")
        #set($sk = "SUPPLEMENTALDATA#$id")
        #set($args = $ctx.stash.supplementalDataArgs)
        $!{args.put('TYPE', 'SupplementalData')}
        $!{args.put('dateModifiedInDynamo', $util.time.nowISO8601())}

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
    new Resolver(this, 'FileFileGroupResolver', {
      api: api,
      typeName: 'File',
      fieldName: 'FileGroup',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.objectFileGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "FILEGROUP#$id")
        {
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson("FILEGROUP"),
            "SK": $util.dynamodb.toDynamoDBJson($fullId),
          }
        }`),
        responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
      })

    new Resolver(this, 'FileGroupFilesResolver', {
      api: api,
      typeName: 'FileGroup',
      fieldName: 'files',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.objectFileGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "FILEGROUP#$id")
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

    new Resolver(this, 'ItemMetadataDefaultFileResolver', {
      api: api,
      typeName: 'ItemMetadata',
      fieldName: 'defaultFile',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.defaultFilePath)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))

        #set($pk = "FILE")
        #set($sk = "FILE#$id")
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
      api: api,
      typeName: 'ItemMetadata',
      fieldName: 'parent',
      pipelineConfig: [getMergedItemRecordFunction, expandSubjectTermsFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.source.parentId)}
        $!{ctx.stash.put("websiteId", $ctx.source.suppliedWebsiteId)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'ItemMetadataChildrenResolver', {
      api: api,
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

    new Resolver(this, 'ItemMetadataFilesResolver', {
      api: api,
      typeName: 'ItemMetadata',
      fieldName: 'files',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.source.objectFileGroupId)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "FILEGROUP#$id")
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

    // Remove corresponding AddItemMetadataToWebsiteInput and type WebsiteItems
    // Remove this after Red Box is modified to use MutationAddItemToWebsite
    new Resolver(this, 'MutationAddItemMetadataToWebsiteResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'addItemMetadataToWebsite',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($websiteId = $ctx.args.input.websiteId)
        #set($websiteId = $util.defaultIfNullOrBlank($websiteId, ""))
        #set($websiteId = $util.str.toUpper($websiteId))
        #set($websiteId = $util.str.toReplace($websiteId, " ", ""))
        #set($itemMetadataId = $ctx.args.input.itemMetadataId)
        #set($itemMetadataId = $util.defaultIfNullOrBlank($itemMetadataId, ""))
        #set($itemMetadataId = $util.str.toUpper($itemMetadataId))
        #set($itemMetadataId = $util.str.toReplace($itemMetadataId, " ", ""))
        #set($pk = "WEBSITE#$websiteId")
        #set($sk = "ITEM#$itemMetadataId")
        #set($GSI1PK = $pk)
        #set($GSI1SK = "ADDED#$util.time.nowISO8601()")

        ## add stash values to enable us to eventually call GetMergedItemRecordFunction
        $!{ctx.stash.put("itemId", $ctx.args.input.itemMetadataId)}
        $!{ctx.stash.put("websiteId", $ctx.args.input.websiteId)}

        {
          "version": "2017-02-28",
          "operation": "UpdateItem",
          "key": {
            "PK": $util.dynamodb.toDynamoDBJson($pk),
            "SK": $util.dynamodb.toDynamoDBJson($sk),
          },
          "update": {
            "expression": "SET itemMetadataId = :itemMetadataId, websiteId = :websiteId, #TYPE = :rowType, dateModifiedInDynamo = :dateModifiedInDynamo, GSI1PK = :GSI1PK, GSI1SK = :GSI1SK, id = :id, title = :title",
            "expressionNames": {"#TYPE": "TYPE"},
            "expressionValues": {
              ":itemMetadataId": $util.dynamodb.toDynamoDBJson($ctx.args.input.itemMetadataId),
              ":websiteId": $util.dynamodb.toDynamoDBJson($ctx.args.input.websiteId),
              ":rowType": $util.dynamodb.toDynamoDBJson("WebSiteItem"),
              ":dateModifiedInDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
              ":GSI1PK": $util.dynamodb.toDynamoDBJson($GSI1PK),
              ":GSI1SK": $util.dynamodb.toDynamoDBJson($GSI1SK),
              ":id": $util.dynamodb.toDynamoDBJson($ctx.args.input.itemMetadataId),
              ":title": $util.dynamodb.toDynamoDBJson($ctx.args.input.itemMetadataId),
            }
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    // Remove once Red Box is updated to use saveCopyrightForWebsite  also remove corresponding ReplaceCopyrightStatementInput from schema
    new Resolver(this, 'MutationReplaceCopyrightStatement', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'replaceCopyrightStatement',
      pipelineConfig: [updateSupplementalDataFunction, updateItemFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($supplementalDataArgs = {})
        #set($itemArgs = {})

        ## set generalCopyrightStatus based on generalInCopyright boolean
        #set($generalCopyrightStatus = 'Copyright')
        #if(!$ctx.args.input.generalInCopyright)
          #set($generalCopyrightStatus = 'not in copyright')
        #end

        $!{supplementalDataArgs.put('generalInCopyright', $ctx.args.input.generalInCopyright)}
        $!{supplementalDataArgs.put('generalCopyrightStatement', $ctx.args.input.generalCopyrightStatement)}
        $!{supplementalDataArgs.put('generalCopyrightStatus', $generalCopyrightStatus)}
        $!{itemArgs.put('copyrightStatement', $ctx.args.input.generalCopyrightStatement)}
        $!{itemArgs.put('copyrightStatus', $generalCopyrightStatus)}

        $!{ctx.stash.put("itemId", $ctx.args.input.id)}
        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}
        $!{ctx.stash.put("itemArgs", $itemArgs)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    // Remove once Red Box is updated to use saveDefaultImageForWebsite also remove corresponding ReplaceDefaultImageInput from schema
    new Resolver(this, 'MutationReplaceDefaultImageResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'replaceDefaultImage',
      pipelineConfig: [updateSupplementalDataFunction, updateItemFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($supplementalDataArgs = {})
        #set($itemArgs = {})

        $!{supplementalDataArgs.put('generalDefaultFilePath', $ctx.args.input.generalDefaultFilePath)}
        $!{supplementalDataArgs.put('generalObjectFileGroupId', $ctx.args.input.generalObjectFileGroupId)}
        $!{itemArgs.put('defaultFilePath', $ctx.args.input.generalDefaultFilePath)}
        $!{itemArgs.put('objectFileGroupId', $ctx.args.input.generalObjectFileGroupId)}

        $!{ctx.stash.put("itemId", $ctx.args.input.id)}
        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}
        $!{ctx.stash.put("itemArgs", $itemArgs)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    // Remove once Red Box is updated to use savePartiallyDigitizedForWebsite also remove corresponding ReplacePartiallyDigitizedInput from schema
    new Resolver(this, 'MutationReplacePartiallyDigitizedResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'replacePartiallyDigitized',
      pipelineConfig: [updateSupplementalDataFunction, updateItemFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($supplementalDataArgs = {})
        #set($itemArgs = {})

        $!{supplementalDataArgs.put('generalPartiallyDigitized', $ctx.args.input.generalPartiallyDigitized)}
        $!{itemArgs.put('partiallyDigitized', $ctx.args.input.generalPartiallyDigitized)}

        $!{ctx.stash.put("itemId", $ctx.args.input.id)}
        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}
        $!{ctx.stash.put("itemArgs", $itemArgs)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })


    new Resolver(this, 'MutationAddItemToWebsiteResolver', {
      api: api,
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
            "expression": "SET itemId = :itemId, websiteId = :websiteId, #TYPE = :rowType, dateModifiedInDynamo = :dateModifiedInDynamo, GSI1PK = :GSI1PK, GSI1SK = :GSI1SK, id = :id, title = :title",
            "expressionNames": {"#TYPE": "TYPE"},
            "expressionValues": {
              ":itemId": $util.dynamodb.toDynamoDBJson($ctx.args.itemId),
              ":websiteId": $util.dynamodb.toDynamoDBJson($ctx.args.websiteId),
              ":rowType": $util.dynamodb.toDynamoDBJson("WebSiteItem"),
              ":dateModifiedInDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
              ":GSI1PK": $util.dynamodb.toDynamoDBJson($GSI1PK),
              ":GSI1SK": $util.dynamodb.toDynamoDBJson($GSI1SK),
              ":id": $util.dynamodb.toDynamoDBJson($ctx.args.itemId),
              ":title": $util.dynamodb.toDynamoDBJson($ctx.args.itemId),
            }
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationRemoveItemFromWebsiteResolver', {
      api: api,
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

    new Resolver(this, 'MutationSaveAdditionalNotesForWebsiteResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'saveAdditionalNotesForWebsite',
      pipelineConfig: [updateSupplementalDataRecordFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.args.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.args.websiteId)}
        #set($supplementalDataArgs = {})
        $!{supplementalDataArgs.put('itemId', $ctx.args.itemId)}
        $!{supplementalDataArgs.put('websiteId', $ctx.args.websiteId)}

        ## note:  $null is an undefined variable, which has the effect of assigning null to our variable
        #set($additionalNotes = $util.defaultIfNullOrBlank($ctx.args.additionalNotes, $null))
        $!{supplementalDataArgs.put('additionalNotes', $additionalNotes)}
        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}

        {}
      `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSaveCopyrightForWebsiteResolver', {
      api: api,
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
        ## set copyrightStatus based on inCopyright boolean
        #set($copyrightStatus = 'Copyright')
        #if(!$ctx.args.inCopyright)
          #set($copyrightStatus = 'not in copyright')
        #end

        $!{supplementalDataArgs.put('copyrightStatus', $copyrightStatus)}
        $!{supplementalDataArgs.put('inCopyright', $ctx.args.inCopyright)}
        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}

        {}
      `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSaveDefaultImageForWebsiteResolver', {
      api: api,
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
        #set($objectFileGroupId = $util.defaultIfNullOrBlank($ctx.args.objectFileGroupId, $null))
        $!{supplementalDataArgs.put('defaultFilePath', $defaultFilePath)}
        $!{supplementalDataArgs.put('objectFileGroupId', $objectFileGroupId)}

        $!{ctx.stash.put("supplementalDataArgs", $supplementalDataArgs)}

        {}
      `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSaveFileLastProcessedDateResolver', {
      api: api,
      typeName: 'Mutation',
      fieldName: 'saveFileLastProcessedDate',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($itemId = $ctx.args.itemId)
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
            "expression": "SET dateLastProcessed = :dateLastProcessed, dateModifiedInDynamo = :dateModifiedInDynamo, GSI2PK = :GSI2PK, GSI2SK = :GSI2SK",
            "expressionValues": {
              ":dateLastProcessed": $util.dynamodb.toDynamoDBJson($dateLastProcessed),
              ":dateModifiedInDynamo": $util.dynamodb.toDynamoDBJson($util.time.nowISO8601()),
              ":GSI2PK": $util.dynamodb.toDynamoDBJson("FILETOPROCESS"),
              ":GSI2SK": $util.dynamodb.toDynamoDBJson($GSI2SK),
            }
          }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'MutationSavePartiallyDigitizedForWebsiteResolver', {
      api: api,
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

    new Resolver(this, 'QueryGetFileGroupResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'getFileGroup',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($id = $ctx.args.id)
        #set($id = $util.defaultIfNullOrBlank($id, ""))
        #set($id = $util.str.toUpper($id))
        #set($id = $util.str.toReplace($id, " ", ""))
        #set($fullId = "FILEGROUP#$id")

        {
            "version": "2017-02-28",
            "operation": "GetItem",
            "key": {
              "PK": $util.dynamodb.toDynamoDBJson("FILEGROUP"),
                "SK": $util.dynamodb.toDynamoDBJson($fullId),
            }
        }`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    new Resolver(this, 'QueryGetFileToProcessRecordResolver', {
      api: api,
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

    new Resolver(this, 'QueryGetItemResolver', {
      api: api,
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

    new Resolver(this, 'QueryGetWebsiteResolver', {
      api: api,
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

    new Resolver(this, 'QueryListFileGroupsResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'listFileGroups',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        {
            "version" : "2017-02-28",
            "operation" : "Query",
            "query" : {
                ## Provide a query expression. **
                "expression": "PK = :id",
                "expressionValues" : {
                    ":id" : $util.dynamodb.toDynamoDBJson("FILEGROUP")
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

    new Resolver(this, 'QueryListFileGroupsByStorageSystemResolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'listFileGroupsByStorageSystem',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($storageSystem = $ctx.args.storageSystem)
        #set($storageSystem = $util.defaultIfNullOrBlank($storageSystem, ""))
        #set($storageSystem = $util.str.toUpper($storageSystem))
        #set($storageSystem = $util.str.toReplace($storageSystem, " ", ""))
        #set($typeOfData = $ctx.args.typeOfData)
        #set($typeOfData = $util.defaultIfNullOrBlank($typeOfData, ""))
        #set($typeOfData = $util.str.toUpper($typeOfData))
        #set($typeOfData = $util.str.toReplace($typeOfData, " ", ""))
        #set($fullId = "FILESYSTEM#$storageSystem#$typeOfData")
        #set($fullId = $util.str.toReplace($fullId, " ", ""))
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "index": "GSI2",
          "query" : {
              "expression": "GSI2PK = :id",
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

    new Resolver(this, 'QueryListFilesToProcessResolver', {
      api: api,
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

    new Resolver(this, 'QueryListFileGroupsForS3Resolver', {
      api: api,
      typeName: 'Query',
      fieldName: 'listFileGroupsForS3',
      dataSource: websiteMetadataDynamoDataSource,
      requestMappingTemplate: MappingTemplate.fromString(`
        #set($fullId = "FILESYSTEM#S3#RBSCWEBSITEBUCKET")
        {
          "version" : "2017-02-28",
          "operation" : "Query",
          "index": "GSI2",
          "query" : {
              "expression": "GSI2PK = :id",
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

    new Resolver(this, 'QueryListItemsBySourceSystemResolver', {
      api: api,
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
      api: api,
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

    new Resolver(this, 'QueryListWebsitesResolver', {
      api: api,
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
      api: api,
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
      api: api,
      typeName: 'WebsiteItem',
      fieldName: 'ItemMetadata',
      pipelineConfig: [getMergedItemRecordFunction, expandSubjectTermsFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.source.itemId)}
        $!{ctx.stash.put("websiteId", $ctx.source.websiteId)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

    // Remove after Red Box has been updated
    new Resolver(this, 'WebsiteItemsItemMetadataResolver', {
      api: api,
      typeName: 'WebsiteItems',
      fieldName: 'ItemMetadata',
      pipelineConfig: [getMergedItemRecordFunction],
      requestMappingTemplate: MappingTemplate.fromString(`
        $!{ctx.stash.put("itemId", $ctx.source.itemMetadataId)}
        $!{ctx.stash.put("websiteId", $ctx.source.websiteId)}

        {}`),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    })

  }
}
