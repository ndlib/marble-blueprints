import cdk = require('@aws-cdk/core');
import { CfnDomain } from '@aws-cdk/aws-elasticsearch';
import { Aws } from '@aws-cdk/core';

export interface ElasticStackProps extends cdk.StackProps {
  readonly esDomainName: string
  readonly namespace: string
}

export class ElasticStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: ElasticStackProps) {
    super(scope, id, props);
    const anonSearch: string = `arn:aws:es:${Aws.REGION}:${Aws.ACCOUNT_ID}:domain/${props.esDomainName}/*/_search`;

    new CfnDomain(this, `${props.namespace}-domain`, {
      elasticsearchVersion: '7.7',
      elasticsearchClusterConfig: this.configCluster(props.namespace),
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
            Resource: anonSearch
          }
        ]
      },
      domainName: props.esDomainName,
      snapshotOptions: { automatedSnapshotStartHour: 4 },
    });
  }

  private configCluster = (namespace: string) => {
    let config: any = {
      instanceCount: 1,
      instanceType: 't2.small.elasticsearch',
    };
    if (this.isProd(namespace)) {
      config.instanceCount = 2
      config.zoneAwarenessEnabled = true
      config.zoneAwarenessConfig = { availabilityZoneCount: 2 }
    }
    return config
  }

  private isProd = (namespace: string) => {
    return namespace.includes('prod');
  }
}
