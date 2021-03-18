import * as ecs from '@aws-cdk/aws-ecs'
import { Rule, Schedule } from '@aws-cdk/aws-events'
import { EcsTask } from '@aws-cdk/aws-events-targets'
import * as iam from '@aws-cdk/aws-iam'
import * as lambda from '@aws-cdk/aws-lambda'
import * as s3 from '@aws-cdk/aws-s3'
import cdk = require('@aws-cdk/core')
import { Annotations } from '@aws-cdk/core'
import fs = require('fs')
import { FoundationStack } from '../foundation'
import { S3NotificationToLambdaCustomResource } from './s3ToLambda'
import { ManifestPipelineStack } from '../manifest-pipeline'
import { MaintainMetadataStack } from '../maintain-metadata'

export interface ImagesStackProps extends cdk.StackProps {
  readonly lambdaCodePath: string;
  readonly dockerfilePath: string;
  readonly rbscBucketName: string;
  readonly manifestPipelineStack: ManifestPipelineStack;
  readonly foundationStack: FoundationStack;
  readonly maintainMetadataStack: MaintainMetadataStack;
}

export class ImagesStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: ImagesStackProps) {
    super(scope, id, props)

    const rbscBucketName = props.rbscBucketName
    const rbscBucket = s3.Bucket.fromBucketName(this, 'RbscBucket', rbscBucketName)
    const processBucket = props.manifestPipelineStack.processBucket
    const imageBucket = props.foundationStack.publicBucket
    const graphqlApiUrlKeyPath = props.maintainMetadataStack.graphqlApiUrlKeyPath
    const graphqlApiKeyKeyPath = props.maintainMetadataStack.graphqlApiKeyKeyPath

    /* get rbsc bucket and attach object listener */
    const changedImgRole = new iam.Role(this, 'S3ImageRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    changedImgRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        processBucket.bucketArn + '/*',
      ],
      actions: [
        "s3:PutObject",
      ],
    }))
    const awsLambdaLoggingPolicy = 'service-role/AWSLambdaBasicExecutionRole'
    const roleLoggingPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName(awsLambdaLoggingPolicy)
    changedImgRole.addManagedPolicy(roleLoggingPolicy)

    if(!fs.existsSync(props.lambdaCodePath)) {
      Annotations.of(this).addError(`Cannot deploy this stack. Asset path not found ${props.lambdaCodePath}`)
      return
    }
    const imageTracker = new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.PYTHON_3_8,
      code: lambda.Code.fromAsset(props.lambdaCodePath),
      handler: 'generate.handler',
      environment: {
        PROCESS_BUCKET: processBucket.bucketName,
      },
      role: changedImgRole,
    })
    // https://github.com/aws/aws-cdk/issues/2004
    new S3NotificationToLambdaCustomResource(this, id, rbscBucket, imageTracker)

    const taskRole = new iam.Role(this, 'MarbleImageTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    })
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        processBucket.bucketArn,
        processBucket.bucketArn + '/*',
        imageBucket.bucketArn,
        imageBucket.bucketArn + '/*',
      ],
      actions: [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
      ],
    }))
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/all/marble*'),
      ],
      actions: ["ssm:Get*"],
    }))
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        rbscBucket.bucketArn + '/*',
      ],
      actions: [
        "s3:GetObject",
      ],
    }))
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + graphqlApiUrlKeyPath),
        cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + graphqlApiKeyKeyPath),
      ],
      actions: ["ssm:Get*"],
    }))

    if(!fs.existsSync(props.dockerfilePath)) {
      Annotations.of(this).addError(`Cannot deploy this stack. Asset path not found ${props.dockerfilePath}`)
      return
    }

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      taskRole: taskRole,
      memoryLimitMiB: 4096,
      cpu: 2048,
    })
    taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromAsset(props.dockerfilePath),
      logging: new ecs.AwsLogDriver({
        logGroup: props.foundationStack.logGroup,
        streamPrefix: `${this.stackName}-AppContainer`,
      }),
      environment: {
        LEVEL0: 'enable',
        RBSC_BUCKET: rbscBucketName,
        PROCESS_BUCKET: processBucket.bucketName,
        IMAGE_BUCKET: imageBucket.bucketName,
        GRAPHQL_API_URL_KEY_PATH: graphqlApiUrlKeyPath,
        GRAPHQL_API_KEY_KEY_PATH: graphqlApiKeyKeyPath,
      },
    })

    const cluster = props.foundationStack.cluster as ecs.Cluster
    const ecsTaskTarget = new EcsTask({
      cluster,
      taskDefinition: taskDef,
    })

    /* setup ECS task to run via cron to process images
       run at 6:30am EST; 11:30am UTC */
    new Rule(this, 'ScheduleRule', {
      schedule: Schedule.cron({ hour: '11', minute: '30' }),
      targets: [ecsTaskTarget],
    })
  }
}