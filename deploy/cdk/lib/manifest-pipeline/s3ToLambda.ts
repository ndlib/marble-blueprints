import * as cr from 'aws-cdk-lib/custom-resources'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'


export class S3NotificationToLambdaCustomResource extends Construct {

    constructor(scope: Construct, id: string, bucket: s3.IBucket, lambda: lambda.Function) {
        super(scope, id)

        // https://stackoverflow.com/questions/58087772/aws-cdk-how-to-add-an-event-notification-to-an-existing-s3-bucket
        const notificationResource = new cr.AwsCustomResource(scope, id + "CustomResource", {
            onCreate: {
                service: 'S3',
                action: 'putBucketNotificationConfiguration',
                parameters: {
                    Bucket: bucket.bucketName,
                    NotificationConfiguration: {
                        LambdaFunctionConfigurations: [
                            {
                                Events: ['s3:ObjectCreated:Put', 's3:ObjectCreated:Post', 's3:ObjectCreated:CompleteMultipartUpload'],
                                LambdaFunctionArn: lambda.functionArn,
                                Filter: {
                                    Key: {
                                        FilterRules: [{ Name: 'prefix', Value: 'Aleph' }],
                                    },
                                },
                            },
                            {
                                Events: ['s3:ObjectCreated:Put', 's3:ObjectCreated:Post', 's3:ObjectCreated:CompleteMultipartUpload'],
                                LambdaFunctionArn: lambda.functionArn,
                                Filter: {
                                    Key: {
                                        FilterRules: [{ Name: 'prefix', Value: 'ArchivesSpace' }],
                                    },
                                },
                            },
                            {
                                Events: ['s3:ObjectCreated:Put', 's3:ObjectCreated:Post', 's3:ObjectCreated:CompleteMultipartUpload'],
                                LambdaFunctionArn: lambda.functionArn,
                                Filter: {
                                    Key: {
                                        FilterRules: [{ Name: 'prefix', Value: 'Curate' }],
                                    },
                                },
                            },
                            {
                                Events: ['s3:ObjectCreated:Put', 's3:ObjectCreated:Post', 's3:ObjectCreated:CompleteMultipartUpload'],
                                LambdaFunctionArn: lambda.functionArn,
                                Filter: {
                                    Key: {
                                        FilterRules: [{ Name: 'prefix', Value: 'other' }],
                                    },
                                },
                            },
                        ],
                    },
                },
                physicalResourceId: <cr.PhysicalResourceId>(id + Date.now().toString()),
            },
            policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({
                // The actual function is PutBucketNotificationConfiguration.
                // The "Action" for IAM policies is PutBucketNotification.
                // https://docs.aws.amazon.com/AmazonS3/latest/dev/list_amazons3.html#amazons3-actions-as-permissions
                actions: ["S3:PutBucketNotification"],
                // allow this custom resource to modify this bucket
                resources: [bucket.bucketArn],
            })]),
            logRetention: logs.RetentionDays.ONE_DAY,
        })

        lambda.addPermission('AllowS3Invocation', {
            action: 'lambda:InvokeFunction',
            principal: new iam.ServicePrincipal('s3.amazonaws.com'),
            sourceArn: bucket.bucketArn,
        })

        // don't create the notification custom-resource until after both the bucket and lambda
        // are fully created and policies applied.
        notificationResource.node.addDependency(bucket)
        notificationResource.node.addDependency(lambda)
        notificationResource.node.addDependency(lambda.permissionsNode.findChild('AllowS3Invocation'))
    }
}