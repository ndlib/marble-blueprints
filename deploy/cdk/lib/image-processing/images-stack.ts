import * as ecs from '@aws-cdk/aws-ecs'
import { Rule, Schedule } from '@aws-cdk/aws-events'
import { EcsTask } from '@aws-cdk/aws-events-targets'
import * as iam from '@aws-cdk/aws-iam'
import cdk = require('@aws-cdk/core')
import { Annotations } from '@aws-cdk/core'
import fs = require('fs')
import { FoundationStack } from '../foundation'
import { ManifestPipelineStack } from '../manifest-pipeline'
import { MaintainMetadataStack } from '../maintain-metadata'

export interface ImagesStackProps extends cdk.StackProps {
  readonly dockerfilePath: string;
  readonly manifestPipelineStack: ManifestPipelineStack;
  readonly foundationStack: FoundationStack;
  readonly maintainMetadataStack: MaintainMetadataStack;
}

export class ImagesStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: ImagesStackProps) {
    super(scope, id, props)

    const imageBucket = props.foundationStack.publicBucket
    const graphqlApiUrlKeyPath = props.maintainMetadataStack.graphqlApiUrlKeyPath
    const graphqlApiKeyKeyPath = props.maintainMetadataStack.graphqlApiKeyKeyPath

    const taskRole = new iam.Role(this, 'MarbleImageTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    })
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
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