import cdk = require('@aws-cdk/core')
import { Topic } from '@aws-cdk/aws-sns'
import { EmailSubscription } from '@aws-cdk/aws-sns-subscriptions'
import { Rule, RuleTargetInput } from '@aws-cdk/aws-events'
import { PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam'
import { SnsTopic } from '@aws-cdk/aws-events-targets'

export interface PipelineMonitorStackProps extends cdk.StackProps {
  readonly mailingList: string
  readonly pipelineName: string
}

export class PipelineMonitorStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: PipelineMonitorStackProps) {
    super(scope, id, props)

    const topic = new Topic(this, 'topic')
    topic.addSubscription(new EmailSubscription(props.mailingList))

    const topicRole = new Role(this, 'topicRole', {
      assumedBy: new ServicePrincipal('events.amazonaws.com'),
    })
    topicRole.addToPolicy(new PolicyStatement({
      resources: [topic.topicArn],
      actions: ['sns:Publish'],
    }))

    const cpEventPattern = {
      source: ['aws.codepipeline'],
      detail: {
          'state': [
            'STARTED',
            'SUCCEEDED',
            'RESUMED',
            'FAILED',
            'CANCELED',
            'SUPERSEDED',
          ],
          'pipeline': [props.pipelineName],
      },
      detailType: ['CodePipeline Pipeline Execution State Change'],
    }
    const rule = new Rule(this, 'CodeBuildCloudWatchEventsRule', {
      description: `${props.pipelineName} CodePipeline Cloudwatch events rule`,
      eventPattern: cpEventPattern,
      enabled: true,
    })
    rule.addTarget(new SnsTopic(topic, {
      message: RuleTargetInput.fromEventPath('$.detail'),
    }))
  }
}
