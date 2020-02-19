import apigateway = require('@aws-cdk/aws-apigateway');
import dynamodb = require('@aws-cdk/aws-dynamodb');
import lambda = require('@aws-cdk/aws-lambda');
import ssm = require('@aws-cdk/aws-ssm');
import cdk = require('@aws-cdk/core');

export interface UserContentStackProps extends cdk.StackProps {
  readonly lambdaCodePath: string
  readonly allowedOrigins: string
  readonly tokenAudiencePath: string
  readonly tokenIssuerPath: string
};

export class UserContentStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: UserContentStackProps) {
    super(scope, id, props);

    // Dynamo Tables
    const userDynamoTable = new dynamodb.Table(this, 'UsersTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'uuid',
        type: dynamodb.AttributeType.STRING
      },
    });
    userDynamoTable.addGlobalSecondaryIndex({
      indexName: 'userName',
      partitionKey: {
        name: 'userName',
        type: dynamodb.AttributeType.STRING
      }
    });

    const collectionDynamoTable = new dynamodb.Table(this, 'CollectionsTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'uuid',
        type: dynamodb.AttributeType.STRING
      },
    });
    collectionDynamoTable.addGlobalSecondaryIndex({
      indexName: 'userId',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING
      }
    });

    const itemDynamoTable = new dynamodb.Table(this, 'ItemsTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'uuid',
        type: dynamodb.AttributeType.STRING
      },
    });
    itemDynamoTable.addGlobalSecondaryIndex({
      indexName: 'collectionId',
      partitionKey: {
        name: 'collectionId',
        type: dynamodb.AttributeType.STRING
      }
    });

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
      }
    });

    // Grants
    userDynamoTable.grantReadWriteData(userContentLambda);
    collectionDynamoTable.grantReadWriteData(userContentLambda);
    itemDynamoTable.grantReadWriteData(userContentLambda);

    // API Gateway
    const api = new apigateway.RestApi(this, 'userContentApi', {
      restApiName: 'Marble User Content Service',
      defaultCorsPreflightOptions: {
        allowOrigins: [props.allowedOrigins],
        allowCredentials: false,
        statusCode: 200,
      },
      endpointExportName: `${this.stackName}-api-url`
    });
    const userContentIntegration = new apigateway.LambdaIntegration(userContentLambda);

    // user endpoints
    const user = api.root.addResource('user');
    const userId = user.addResource('{id}')
    userId.addMethod('POST', userContentIntegration);
    userId.addMethod('GET', userContentIntegration);
    userId.addMethod('PATCH', userContentIntegration);
    userId.addMethod('DELETE', userContentIntegration);

    const userByUuid = api.root.addResource('user-id');
    const userByUuidId = userByUuid.addResource('{id}')
    userByUuidId.addMethod('GET', userContentIntegration);

    // collection endpoints
    const collection = api.root.addResource('collection');
    const collectionId = collection.addResource('{id}')
    collectionId.addMethod('POST', userContentIntegration);
    collectionId.addMethod('GET', userContentIntegration);
    collectionId.addMethod('PATCH', userContentIntegration);
    collectionId.addMethod('DELETE', userContentIntegration);

    // item endpoints
    const item = api.root.addResource('item');
    const itemId = item.addResource('{id}')
    itemId.addMethod('POST', userContentIntegration);
    itemId.addMethod('GET', userContentIntegration);
    itemId.addMethod('PATCH', userContentIntegration);
    itemId.addMethod('DELETE', userContentIntegration);
  }
}