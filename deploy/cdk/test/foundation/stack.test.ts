import { expect as expectCDK, MatchStyle, matchTemplate, haveResource, haveResourceLike } from '@aws-cdk/assert';
import cdk = require('@aws-cdk/core');
import { FoundationStack } from '../../lib/foundation';

describe('FoundationStack', () => {
  describe('VPC', () => {
    test('creates an internet gateway', () => {
        const app = new cdk.App();
        // WHEN
        const stack = new FoundationStack(app, 'MyTestStack', {
          domainName: 'test.edu',
        });
        // THEN
        expectCDK(stack).to(haveResource('AWS::EC2::InternetGateway'));
    })

    test('creates two private subnets and two public subnets', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
      });
      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::EC2::Subnet', {
        AvailabilityZone: {
          "Fn::Select": [0, { "Fn::GetAZs": "" }]
        },
        "MapPublicIpOnLaunch": false,
      }));
      expectCDK(stack).to(haveResourceLike('AWS::EC2::Subnet', {
        AvailabilityZone: {
          "Fn::Select": [1, { "Fn::GetAZs": "" }]
        },
        "MapPublicIpOnLaunch": false,
      }));
      expectCDK(stack).to(haveResourceLike('AWS::EC2::Subnet', {
        AvailabilityZone: {
          "Fn::Select": [0, { "Fn::GetAZs": "" }]
        },
        "MapPublicIpOnLaunch": true,
      }));
      expectCDK(stack).to(haveResourceLike('AWS::EC2::Subnet', {
        AvailabilityZone: {
          "Fn::Select": [1, { "Fn::GetAZs": "" }]
        },
        "MapPublicIpOnLaunch": true,
      }));
    })

    test('creates a NAT gateway for each public subnet', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
      });
      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::EC2::NatGateway', {
        "SubnetId": {
          "Ref": "VPCPublicSubnet1SubnetB4246D30"
        },
      }));
      expectCDK(stack).to(haveResourceLike('AWS::EC2::NatGateway', {
        "SubnetId": {
          "Ref": "VPCPublicSubnet2Subnet74179F39"
        },
      }));
    });
  });

  describe('Domain', () => {
    test('creates a wildcard certificate for the domain', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
      });
      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::CertificateManager::Certificate', {
        DomainName: '*.test.edu',
        DomainValidationOptions: [{
          DomainName: '*.test.edu',
          ValidationDomain: '*.test.edu',
        }],
        ValidationMethod: "DNS",
      }));
    });

    test('creates a Route53 for the domain when doCreateZone is true', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
        doCreateZone: true,
      });
      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Route53::HostedZone', {
        Name: 'test.edu',
      }));
    });

    test('does not create a Route53 for the domain when doCreateZone is false', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
        doCreateZone: false,
      });
      // THEN
      expectCDK(stack).notTo(haveResource('AWS::Route53::HostedZone'));
    });
  });
});