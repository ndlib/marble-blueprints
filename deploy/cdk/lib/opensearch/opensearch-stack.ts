import { Stack, StackProps } from 'aws-cdk-lib'
import { CfnServiceLinkedRole } from 'aws-cdk-lib/aws-iam'
import { Domain, EngineVersion } from 'aws-cdk-lib/aws-opensearchservice'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { EbsDeviceVolumeType } from 'aws-cdk-lib/aws-ec2'
import { Construct } from "constructs"

export interface OpenSearchStackProps extends StackProps {
  readonly namespace: string
  readonly contextEnvName: string
}

export class OpenSearchStack extends Stack {
  readonly domainName: string
  readonly domain: Domain
  readonly domainEndpointKeyPath: string
  readonly domainNameKeyPath: string
  readonly domainArnKeyPath: string
  readonly domainMasterUserNameKeyPath: string
  readonly domainMasterPasswordKeyPath: string
  readonly domainReadOnlyUserNameKeyPath: string
  readonly domainReadOnlyPasswordKeyPath: string

  constructor(scope: Construct, id: string, props: OpenSearchStackProps) {
    super(scope, id, props)

    const masterNodes = this.isProd(props.contextEnvName) ? 3 : 0
    const masterNodeInstanceType = 'm5.large.search' // Based upon recommendation here: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-dedicatedmasternodes.html
    const dataNodes = this.isProd(props.contextEnvName) ? 4 : 1 // We must choose an even number of data nodes (greater than 2) for a two Availability Zone deployment
    const dataNodeInstanceType = 't3.medium.search' // T2 does not support encryption at rest, which is required when selecting useUnsignedBasicAuth
    const zoneAwarenessEanbled = this.isProd(props.contextEnvName) ? true : false
    const zoneAwarenessAvailabilityZoneCount = this.isProd(props.contextEnvName) ? 2 : 2  // 2 is the minimum availability zone count
    const masterUserName = 'admin'

    this.domain = new Domain(this, `${props.namespace}-domain`, {
      enableVersionUpgrade: true,
      version: EngineVersion.OPENSEARCH_1_0,
      capacity: {
        masterNodes: masterNodes,
        masterNodeInstanceType: masterNodeInstanceType,
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
    this.domainMasterUserNameKeyPath = `/all/stacks/${this.stackName}/master-user-name`
    this.domainMasterPasswordKeyPath = `/all/stacks/${this.stackName}/master-user-password`
    this.domainReadOnlyUserNameKeyPath = `/all/stacks/${this.stackName}/read-only-user-name`
    this.domainReadOnlyPasswordKeyPath = `/all/stacks/${this.stackName}/read-only-password`
        
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
      stringValue: this.domain.domainName,
    })

    new StringParameter(this, 'DomainArnParam', {
      parameterName: this.domainArnKeyPath,
      stringValue: this.domain.domainArn,
    })

    new StringParameter(this, 'DomainMasterUserNameParam', {
      parameterName: this.domainMasterUserNameKeyPath,
      stringValue: masterUserName,
    })

    new StringParameter(this, 'DomainMasterPasswordParam', {
      parameterName: this.domainMasterPasswordKeyPath,
      stringValue: `${this.domain.masterUserPassword}`,
    })

    new StringParameter(this, 'DomainReadOnlyUserNameParam', {
      parameterName: this.domainReadOnlyUserNameKeyPath,
      stringValue: 'readOnly',
    })

    new StringParameter(this, 'DomainReadOnlyPasswordParam', {
      parameterName: this.domainReadOnlyPasswordKeyPath,
      stringValue: 'readOnly1!',
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
