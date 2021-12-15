import cdk = require('@aws-cdk/core')
import { CfnServiceLinkedRole } from '@aws-cdk/aws-iam'
import { Domain, EngineVersion } from '@aws-cdk/aws-opensearchservice'
import { StringParameter } from '@aws-cdk/aws-ssm'
import { EbsDeviceVolumeType } from '@aws-cdk/aws-ec2'

export interface OpenSearchStackProps extends cdk.StackProps {
  readonly namespace: string
  readonly contextEnvName: string
}

export class OpenSearchStack extends cdk.Stack {
  readonly domainName: string
  readonly domain: Domain
  readonly domainEndpointKeyPath: string
  readonly domainNameKeyPath: string
  readonly domainArnKeyPath: string

  constructor(scope: cdk.Construct, id: string, props: OpenSearchStackProps) {
    super(scope, id, props)

    const masterNodes = 0
    const dataNodes = this.isProd(props.contextEnvName) ? 3 : 1
    const dataNodeInstanceType = this.isProd(props.contextEnvName) ? 't3.medium.search' : 't3.small.search' // T2 does not support encryption at rest, which is required when selecting useUnsignedBasicAuth
    const zoneAwarenessEanbled = this.isProd(props.contextEnvName) ? true : false
    const zoneAwarenessAvailabilityZoneCount = this.isProd(props.contextEnvName) ? 2 : 2  // 2 is the minimum availability zone count
    const masterUserName = 'admin'

    this.domain = new Domain(this, `${props.namespace}-domain`, {
      enableVersionUpgrade: true,
      version: EngineVersion.OPENSEARCH_1_0,
      capacity: {
        masterNodes: masterNodes,
        dataNodes: dataNodes,
        dataNodeInstanceType: dataNodeInstanceType,
      },
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true,
      },
      ebs: {
        volumeSize: 10,
        enabled: true,
        volumeType: EbsDeviceVolumeType.GP2,
      },
      zoneAwareness: {
        enabled: zoneAwarenessEanbled,
        availabilityZoneCount: zoneAwarenessAvailabilityZoneCount,
      },
      automatedSnapshotStartHour: 4,
      useUnsignedBasicAuth: true,
      fineGrainedAccessControl: {
        masterUserName: masterUserName,
      },
    })

    this.domainEndpointKeyPath = `/all/stacks/${this.stackName}/domain-endpoint`
    this.domainNameKeyPath = `/all/stacks/${this.stackName}/domain-name`
    this.domainArnKeyPath = `/all/stacks/${this.stackName}/domain-arn`
    
    new StringParameter(this, 'DomainEndpointParam', {
      parameterName: this.domainEndpointKeyPath,
      stringValue: `https://${this.domain.domainEndpoint}`,
    })

    // In theory, we can import this in the Static Hosts stack like this:
    // const domainEndpoint = 'https://my-domain-jcjotrt6f7otem4sqcwbch3c4u.us-east-1.es.amazonaws.com';
    // const domain = Domain.fromDomainEndpoint(this, 'ImportedDomain', domainEndpoint);
    // Then we can grant privileges like this:
    // Grant write access to the app-search index
    // domain.grantIndexWrite('app-search', lambda);

    // Grant read access to the 'app-search/_search' path
    // domain.grantPathRead('app-search/_search', lambda);

    new StringParameter(this, 'DomainNameParam', {
      parameterName: this.domainNameKeyPath,
      stringValue: `https://${this.domain.domainName}`,
    })

    new StringParameter(this, 'DomainArnParam', {
      parameterName: this.domainArnKeyPath,
      stringValue: this.domain.domainArn,
    })

    new StringParameter(this, 'DomainMasterUserNameParam', {
      parameterName: `/all/stacks/${this.stackName}/master-user-name`,
      stringValue: masterUserName,
    })

    new StringParameter(this, 'DomainMasterPasswordParam', {
      parameterName: `/all/stacks/${this.stackName}/master-user-password`,
      stringValue: `${this.domain.masterUserPassword}`,
    })

    // Created a Service Linked Role
    new CfnServiceLinkedRole(this, 'Service Linked Role', {
      awsServiceName: 'es.amazonaws.com',
    })
  }

  private isProd = (environment: string) => {
    return environment.includes('prod')
  }
}
