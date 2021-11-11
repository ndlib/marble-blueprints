import cdk = require('@aws-cdk/core')
import { CfnDomain } from '@aws-cdk/aws-elasticsearch'
import { Aws } from '@aws-cdk/core'
import { StringParameter } from '@aws-cdk/aws-ssm'

export interface ElasticStackProps extends cdk.StackProps {
  readonly namespace: string
  readonly contextEnvName: string
}

export class ElasticStack extends cdk.Stack {
  readonly domainName: string
  readonly domain: CfnDomain

  constructor(scope: cdk.Construct, id: string, props: ElasticStackProps) {
    super(scope, id, props)
    this.domainName = `${props.namespace}-sites`  // We'd like to let CloudFormation define the domain name, but we can't because of synthetics
    const anonSearch = `arn:aws:es:${Aws.REGION}:${Aws.ACCOUNT_ID}:domain/${this.domainName}/*/_search`

    this.domain = new CfnDomain(this, `${props.namespace}-domain`, {
      elasticsearchVersion: '7.7',
      elasticsearchClusterConfig: this.configCluster(props.contextEnvName),
      ebsOptions: {
        ebsEnabled: true,
        volumeSize: 10,
        volumeType: 'gp2',
      },
      accessPolicies: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: [
              'es:ESHttpPost',
              'es:ESHttpGet',
            ],
            Resource: anonSearch,
          },
        ],
      },
      domainName: this.domainName,
      snapshotOptions: { automatedSnapshotStartHour: 4 },
    })

    new StringParameter(this, 'DomainEndpointParam', {
      parameterName: `/all/stacks/${this.stackName}/domain-endpoint`,
      stringValue: `https://${this.domain.attrDomainEndpoint}`,
    })
  }

  private configCluster = (environment: string) => {
    const config: any = {
      instanceCount: 1,
      instanceType: 't2.small.elasticsearch',
    }
    if (this.isProd(environment)) {
      config.instanceCount = 2
      config.zoneAwarenessEnabled = true
      config.zoneAwarenessConfig = { availabilityZoneCount: 2 }
    }
    return config
  }

  private isProd = (environment: string) => {
    return environment.includes('prod')
  }
}
