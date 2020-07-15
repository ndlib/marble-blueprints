import cdk = require('@aws-cdk/core');
import * as s3 from '@aws-cdk/aws-s3';
import { Rule, Schedule } from '@aws-cdk/aws-events';
import { EcsTask } from '@aws-cdk/aws-events-targets';
import * as iam from '@aws-cdk/aws-iam';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as lambda from '@aws-cdk/aws-lambda';
import { S3NotificationToLambdaCustomResource } from './s3ToLambda';


export interface IMarbleImagesStackProps extends cdk.StackProps {
  readonly stage: string
  readonly lambdaCodePath: string
  readonly dockerfilePath: string
  readonly envSettings: any
}

export default class MarbleImagesStack extends cdk.Stack {

  constructor(scope: cdk.Construct, id: string, props: IMarbleImagesStackProps) {
    super(scope, id, props);

    let env = props.envSettings.test
    if(props.stage === "prod") {
        env = props.envSettings.prod
    }

    const rbscBucketName = env.rbscBucket;
    const rbscBucket = s3.Bucket.fromBucketName(this, 'MarbleImgRbscBucket', rbscBucketName);
    const processBucketName = env.processBucket;
    const processBucket = s3.Bucket.fromBucketName(this, 'MarbleImgProcessBucket', processBucketName);
    const imageBucketName = env.imageBucket;
    const imageBucket = s3.Bucket.fromBucketName(this, 'MarbleImgImageBucket', imageBucketName);

    /* get rbsc bucket and attach object listener */
    const changedImgRole = new iam.Role(this, 'MarbleImgS3ImageRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    changedImgRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        processBucket.bucketArn + '/*',
      ],
      actions: [
        "s3:PutObject",
      ],
    }));
    const awsLambdaLoggingPolicy = 'service-role/AWSLambdaBasicExecutionRole'
    const roleLoggingPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName(awsLambdaLoggingPolicy)
    changedImgRole.addManagedPolicy(roleLoggingPolicy)

    const imageTracker = new lambda.Function(this, 'MarbleImgHandler', {
      runtime: lambda.Runtime.PYTHON_3_8,
      code: lambda.Code.fromAsset(props.lambdaCodePath),
      handler: 'generate.handler',
      environment: {
        PROCESS_BUCKET: processBucketName,
      },
      role: changedImgRole,
    });
    // https://github.com/aws/aws-cdk/issues/2004
    new S3NotificationToLambdaCustomResource(this, id, rbscBucket, imageTracker);

    /* setup environment for EC2 to live and process image file changes.
        the imports come from the network stack; see readme.md for details */
    const networkStackName = 'marble-network';
    const vpcId = cdk.Fn.importValue(`${networkStackName}:VPCID`);
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'MarbleImgVPC', {
      vpcId,
      availabilityZones: [
        cdk.Fn.select(0, cdk.Fn.getAzs()),
        cdk.Fn.select(1, cdk.Fn.getAzs()),
      ],
      publicSubnetIds: [
        cdk.Fn.importValue(`${networkStackName}:PublicSubnet1ID`),
        cdk.Fn.importValue(`${networkStackName}:PublicSubnet2ID`),
      ],
      privateSubnetIds: [
        cdk.Fn.importValue(`${networkStackName}:PrivateSubnet1ID`),
        cdk.Fn.importValue(`${networkStackName}:PrivateSubnet2ID`),
      ],
    });
    const cluster = new ecs.Cluster(this, 'MarbleImgCluster', { vpc });
    cluster.addCapacity('MarbleImgEc2Group', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
    });

    const taskRole = new iam.Role(this, 'MarbleImageTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
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
        "s3:ListBucket"
      ],
    }));
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        cdk.Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/all/marble*'),
      ],
      actions: ["ssm:GetParameter"],
    }))
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [
        rbscBucket.bucketArn + '/*',
      ],
      actions: [
        "s3:GetObject",
      ],
    }));

    const taskDef = new ecs.Ec2TaskDefinition(this, "MarbleImgTaskDefinition", {taskRole: taskRole});
    const logging = new ecs.AwsLogDriver({streamPrefix: 'marbleimg'});
    taskDef.addContainer("MarbleImgAppContainer", {
      image: ecs.ContainerImage.fromAsset(props.dockerfilePath),
      memoryLimitMiB: 512,
      logging,
      environment: {
        RBSC_BUCKET: rbscBucketName,
        PROCESS_BUCKET: processBucketName,
        IMAGE_BUCKET: imageBucketName,
      },
    })

    const ecsTaskTarget = new EcsTask({
      cluster: cluster,
      taskDefinition: taskDef
    });

    /* setup ECS to run via cron to process images */
    new Rule(this, 'MarbleImgScheduleRule', {
      schedule: Schedule.cron({ minute: '0,15,30,45' }),
      targets: [ecsTaskTarget],
    });
  }
}
