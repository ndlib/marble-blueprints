import apigateway = require('@aws-cdk/aws-apigateway')
import dynamodb = require('@aws-cdk/aws-dynamodb')
import lambda = require('@aws-cdk/aws-lambda')
import { CnameRecord } from '@aws-cdk/aws-route53'
import ssm = require('@aws-cdk/aws-ssm')
import cdk = require('@aws-cdk/core')
import fs = require('fs')
import { FoundationStack } from '../foundation'
import { StringParameter } from '@aws-cdk/aws-ssm'

export interface UserContentStackProps extends cdk.StackProps {
  readonly lambdaCodePath: string;
  readonly allowedOrigins: string;
  readonly tokenAudiencePath: string;
  readonly tokenIssuerPath: string;
  readonly hostnamePrefix: string;
  readonly foundationStack: FoundationStack;
  readonly createDns: boolean;
  readonly namespace: string;
}

export class UserContentStack extends cdk.Stack {
  readonly apiName: string

  constructor(scope: cdk.Construct, id: string, props: UserContentStackProps) {
    super(scope, id, props)

    this.apiName = `${props.namespace}-user-content`

    if(!fs.existsSync(props.lambdaCodePath)) {
      this.node.addError(`Cannot deploy this stack. Asset path not found ${props.lambdaCodePath}`)
      return
    }

    // Dynamo Tables
    const userDynamoTable = new dynamodb.Table(this, 'UsersTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'uuid',
        type: dynamodb.AttributeType.STRING,
      },
    })
    userDynamoTable.addGlobalSecondaryIndex({
      indexName: 'userName',
      partitionKey: {
        name: 'userName',
        type: dynamodb.AttributeType.STRING,
      },
    })

    const collectionDynamoTable = new dynamodb.Table(this, 'CollectionsTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'uuid',
        type: dynamodb.AttributeType.STRING,
      },
    })
    collectionDynamoTable.addGlobalSecondaryIndex({
      indexName: 'userId',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
    })

    const itemDynamoTable = new dynamodb.Table(this, 'ItemsTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'uuid',
        type: dynamodb.AttributeType.STRING,
      },
    })
    itemDynamoTable.addGlobalSecondaryIndex({
      indexName: 'collectionId',
      partitionKey: {
        name: 'collectionId',
        type: dynamodb.AttributeType.STRING,
      },
    })

    // Lambda Functions
    const codeAsset = lambda.Code.fromAsset(props.lambdaCodePath)
    const userContentLambda = new lambda.Function(this, 'userContentFunction', {
      code: codeAsset,
      handler: 'lambda.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {
        USER_TABLE_NAME: userDynamoTable.tableName,
        USER_PRIMARY_KEY: 'uuid',
        USER_SECONDARY_KEY: 'userName',
        COLLECTION_TABLE_NAME: collectionDynamoTable.tableName,
        COLLECTION_PRIMARY_KEY: 'uuid',
        COLLECTION_SECONDARY_KEY: 'userId',
        ITEM_TABLE_NAME: itemDynamoTable.tableName,
        ITEM_PRIMARY_KEY: 'uuid',
        ITEM_SECONDARDY_KEY: 'collectionId',
        TOKEN_ISSUER: ssm.StringParameter.fromStringParameterName(this, 'TokenIssuer', props.tokenIssuerPath).stringValue,
        TOKEN_AUDIENCE: ssm.StringParameter.fromStringParameterName(this, 'Audience', props.tokenAudiencePath).stringValue,
      },
    })

    // Grants
    userDynamoTable.grantReadWriteData(userContentLambda)
    collectionDynamoTable.grantReadWriteData(userContentLambda)
    itemDynamoTable.grantReadWriteData(userContentLambda)

    // API Gateway
    const domainName = `${props.hostnamePrefix}.` + props.foundationStack.hostedZone.zoneName
    const domainCert = props.foundationStack.certificate
    const api = new apigateway.RestApi(this, 'userContentApi', {
      restApiName: this.apiName,
      defaultCorsPreflightOptions: {
        allowOrigins: [props.allowedOrigins],
        allowCredentials: false,
        statusCode: 200,
      },
      domainName: {
        certificate: domainCert,
        domainName,
      },
      endpointExportName: `${this.stackName}-api-url`,
    })
    const userContentIntegration = new apigateway.LambdaIntegration(userContentLambda)

    if (props.createDns) {
      new CnameRecord(this, `${id}-Route53CnameRecord`, {
        recordName: props.hostnamePrefix,
        domainName: api.domainName!.domainNameAliasDomainName, // cloudfront the api creates
        zone: props.foundationStack.hostedZone,
        ttl: cdk.Duration.minutes(15),
      })
    }
    // user endpoints
    const user = api.root.addResource('user')
    const userId = user.addResource('{id}')
    userId.addMethod('POST', userContentIntegration)
    userId.addMethod('GET', userContentIntegration)
    userId.addMethod('PATCH', userContentIntegration)
    userId.addMethod('DELETE', userContentIntegration)

    const userByUuid = api.root.addResource('user-id')
    const userByUuidId = userByUuid.addResource('{id}')
    userByUuidId.addMethod('GET', userContentIntegration)

    // collection endpoints
    const collection = api.root.addResource('collection')
    const collectionId = collection.addResource('{id}')
    collectionId.addMethod('POST', userContentIntegration)
    collectionId.addMethod('GET', userContentIntegration)
    collectionId.addMethod('PATCH', userContentIntegration)
    collectionId.addMethod('DELETE', userContentIntegration)

    // item endpoints
    const item = api.root.addResource('item')
    const itemId = item.addResource('{id}')
    itemId.addMethod('POST', userContentIntegration)
    itemId.addMethod('GET', userContentIntegration)
    itemId.addMethod('PATCH', userContentIntegration)
    itemId.addMethod('DELETE', userContentIntegration)

    new StringParameter(this, 'UsersTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/users-tablename`,
      stringValue: userDynamoTable.tableName,
    })
    new StringParameter(this, 'CollectionsTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/collections-tablename`,
      stringValue: collectionDynamoTable.tableName,
    })
    new StringParameter(this, 'ItemsTableNameParam', {
      parameterName: `/all/stacks/${this.stackName}/items-tablename`,
      stringValue: itemDynamoTable.tableName,
    })
  }
}
