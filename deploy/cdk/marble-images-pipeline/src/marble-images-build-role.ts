import { PolicyStatement, Role, RoleProps, ServicePrincipal, Effect } from '@aws-cdk/aws-iam'
import { Bucket } from '@aws-cdk/aws-s3'
import cdk = require('@aws-cdk/core')
import { Fn } from '@aws-cdk/core'

export interface IMarbleImagesBuildRoleProps extends RoleProps {
  readonly stages: string[]
  readonly artifactBucket: Bucket
  readonly envSettings: any
}

export class MarbleImagesBuildRole extends Role {
  constructor(scope: cdk.Construct, id: string, props: IMarbleImagesBuildRoleProps) {
    super(scope, id, props)

    const serviceStackPrefix = scope.node.tryGetContext('serviceStackName') || 'marbleImages'
    const serviceStacks = props.stages.map(stage => `${serviceStackPrefix}-${stage}`)

    // Allow Cloudformation to assume this role so it can be associated with a stack
    // This is so we can overwrite the service role on marbleImages-prod that cannot be removed, only replaced
    this.assumeRolePolicy!.addStatements(
      new PolicyStatement({
        principals: [new ServicePrincipal('cloudformation.amazonaws.com')],
        actions: ['sts:AssumeRole'],
      }),
    )

    // Allow checking what policies are attached to this role
    this.addToPolicy(
      new PolicyStatement({
        resources: [this.roleArn],
        actions: ['iam:GetRolePolicy'],
      }),
    )
    const instanceProfileStatement = new PolicyStatement({
      resources: [], // Added later dynamically
      actions: ['iam:CreateInstanceProfile', 'iam:AddRoleToInstanceProfile']
    })
    serviceStacks.forEach(stackName => {
      instanceProfileStatement.addResources(Fn.sub('arn:aws:iam::${AWS::AccountId}:instance-profile/' + stackName + '*'))
    })
    this.addToPolicy(instanceProfileStatement)
    // Allow modifying IAM roles related to our application
    const iamStatement = new PolicyStatement({
      resources: [], // Added later dynamically
      actions: [
        'iam:GetRole',
        'iam:GetRolePolicy',
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:PutRolePolicy',
        'iam:PassRole',
        'iam:TagRole',
      ],
    })
    serviceStacks.forEach(stackName => {
      iamStatement.addResources(Fn.sub('arn:aws:iam::${AWS::AccountId}:role/' + stackName + '*'))
    })
    this.addToPolicy(iamStatement)

    // Global resource permissions for managing cloudformation and logs
    this.addToPolicy(
      new PolicyStatement({
        resources: ['*'],
        actions: [
          'cloudformation:ListExports',
          'logs:CreateLogGroup',
          'logs:DescribeLogGroups'
        ],
      }),
    )

    // Allow logging for this stack
    this.addToPolicy(
      new PolicyStatement({
        resources: [
          Fn.sub('arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/codebuild/${AWS::StackName}-*'),
        ],
        actions: ['logs:CreateLogStream'],
      }),
    )
    this.addToPolicy(
      new PolicyStatement({
        resources: [
          Fn.sub(
            'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/codebuild/${AWS::StackName}-*:log-stream:*',
          ),
        ],
        actions: ['logs:PutLogEvents'],
      }),
    )

    // Allow storing artifacts in S3 buckets
    this.addToPolicy(
      new PolicyStatement({
        resources: [props.artifactBucket.bucketArn, 'arn:aws:s3:::cdktoolkit-stagingbucket-*'],
        actions: ['s3:ListBucket', 's3:ListBucketVersions', 's3:GetBucketLocation', 's3:GetBucketPolicy'],
      }),
    )
    this.addToPolicy(
      new PolicyStatement({
        resources: [props.artifactBucket.bucketArn + '/*', 'arn:aws:s3:::cdktoolkit-stagingbucket-*/*'],
        actions: ['s3:GetObject', 's3:PutObject'],
      }),
    )

    this.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [
          Fn.sub('arn:aws:ecr:${AWS::Region}:${AWS::AccountId}:repository/aws-cdk/assets'),
        ],
        actions: ['ecr:DescribeRepositories', 'ecr:DescribeImages'],
      }),
    )

    const launchConfigStatement = new PolicyStatement({
      resources: [], // Added later dynamically
      actions: ['autoscaling:CreateLaunchConfiguration']
    })
    serviceStacks.forEach(stackName => {
      launchConfigStatement.addResources(
        Fn.sub('arn:aws:autoscaling:${AWS::Region}:${AWS::AccountId}:launchConfiguration:*:launchConfigurationName/' + stackName + '*'),
    )})
    this.addToPolicy(launchConfigStatement)
    const autoscaleStatement = new PolicyStatement({
      resources: [], // Added later dynamically
      actions: [
        'autoscaling:CreateAutoScalingGroup',
        'autoscaling:UpdateAutoScalingGroup',
        'autoscaling:PutLifecycleHook'
      ]
    })
    serviceStacks.forEach(stackName => {
      autoscaleStatement.addResources(
        Fn.sub('arn:aws:autoscaling:${AWS::Region}:${AWS::AccountId}:autoScalingGroup:*:autoScalingGroupName/' + stackName + '*'),
    )})
    this.addToPolicy(autoscaleStatement)
    this.addToPolicy(
      new PolicyStatement({
        resources: ['*'],
        actions: ['autoscaling:Describe*'],
      }),
    )

    this.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: ['*'],
        actions: [
          'ec2:Describe*',
          'ec2:CreateSecurityGroup',
          'ec2:createTags',
          'ec2:RevokeSecurityGroupEgress',
          'ec2:AuthorizeSecurityGroupEgress',
        ],
      }),
    )

    this.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: ['*'],
        actions: ['ecs:Describe*', 'ecs:CreateCluster', 'ecs:RegisterTaskDefinition'],
      }),
    )

    const snsStatement = new PolicyStatement({
      resources: [], // Added later dynamically
      actions: [
        'sns:CreateTopic',
        'sns:GetTopicAttributes',
        'sns:Subscribe'
      ]
    })
    serviceStacks.forEach(stackName => {
      snsStatement.addResources(
        Fn.sub('arn:aws:sns:${AWS::Region}:${AWS::AccountId}:' + stackName + '*'),
    )})
    this.addToPolicy(snsStatement)

    // Allow creating and managing lambda with this stack name
    const lambdaStatement = new PolicyStatement({
      resources: [], // Added later dynamically
      actions: ['lambda:*'],
    })
    serviceStacks.forEach(stackName => {
      lambdaStatement.addResources(
        Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:' + stackName + '*'),
      )
    })
    this.addToPolicy(lambdaStatement)
    this.addToPolicy(
      new PolicyStatement({
        resources: ['*'],
        actions: [
          'lambda:CreateEventSourceMapping',
          'lambda:GetEventSourceMapping',
          'lambda:UpdateEventSourceMapping',
          'lambda:DeleteEventSourceMapping',
          'lambda:PutFunctionEventInvokeConfig',
        ],
      }),
    )

    // Allow fetching details about and updating the application stack
    const cfnStatement = new PolicyStatement({
      resources: [], // Added later dynamically
      actions: [
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:DescribeChangeSet',
        'cloudformation:CreateChangeSet',
        'cloudformation:ExecuteChangeSet',
        'cloudformation:DeleteChangeSet',
        'cloudformation:DeleteStack',
        'cloudformation:GetTemplate',
      ],
    })
    serviceStacks.forEach(stackName => {
      cfnStatement.addResources(
        Fn.sub('arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/' + stackName + '/*'),
      )
    })
    this.addToPolicy(cfnStatement)

    // Allow reading some details about CDKToolkit stack so we can use the CDK CLI successfully from CodeBuild.
    this.addToPolicy(
      new PolicyStatement({
        resources: [Fn.sub('arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/CDKToolkit/*')],
        actions: ['cloudformation:DescribeStacks'],
      }),
    )

    // Allow managing events for this stack's resources
    const eventsStatement = new PolicyStatement({
      resources: [], // Added later dynamically
      actions: [
        'events:PutEvents',
        'events:DescribeRule',
        'events:PutRule',
        'events:DeleteRule',
        'events:TagResource',
        'events:UntagResource',
        'events:PutTargets',
        'events:RemoveTargets',
      ],
    })
    serviceStacks.forEach(stackName => {
      eventsStatement.addResources(Fn.sub('arn:aws:events:${AWS::Region}:${AWS::AccountId}:rule/' + stackName + '*'))
    })
    this.addToPolicy(eventsStatement)

    this.addToPolicy(
      new PolicyStatement({
        resources: ['*'],
        actions: ['ssm:Get*'],
      }),
    )
  }
}

export default MarbleImagesBuildRole
