import * as ecs from 'aws-cdk-lib/aws-ecs'
import { Rule, Schedule } from 'aws-cdk-lib/aws-events'
import { EcsTask } from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Fn, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from "constructs"
import { FoundationStack } from '../foundation'
import { ManifestPipelineStack } from '../manifest-pipeline'
import { MaintainMetadataStack } from '../maintain-metadata'
import { AssetHelpers } from '../asset-helpers'

export interface ImagesStackProps extends StackProps {
  readonly dockerfilePath: string
  readonly rbscBucketName: string
  readonly marbleContentBucketName: string
  readonly manifestPipelineStack: ManifestPipelineStack
  readonly foundationStack: FoundationStack
  readonly maintainMetadataStack: MaintainMetadataStack
}

export class ImagesStack extends Stack {
  constructor(scope: Construct, id: string, props: ImagesStackProps) {
    super(scope, id, props)

    const rbscBucketName = props.rbscBucketName
    const rbscBucket = s3.Bucket.fromBucketName(this, 'RbscBucket', rbscBucketName)
    const marbleContentBucket = s3.Bucket.fromBucketName(this, 'MarbleContentBucket', props.marbleContentBucketName)
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
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/all/marble*'),
      ],
      actions: ["ssm:Get*"],
    }))
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        rbscBucket.bucketArn + '/*',
        marbleContentBucket.bucketArn + '/*',
      ],
      actions: [
        "s3:GetObject",
      ],
    }))
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + graphqlApiUrlKeyPath),
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter' + graphqlApiKeyKeyPath),
      ],
      actions: ["ssm:Get*"],
    }))

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      taskRole: taskRole,
      memoryLimitMiB: 4096,
      cpu: 2048,
    })
    taskDef.addContainer("AppContainer", {
      image: AssetHelpers.containerFromDockerfile(this, 'DockerImageAsset', { directory: props.dockerfilePath }),
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