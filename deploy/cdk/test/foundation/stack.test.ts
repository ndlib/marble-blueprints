import { Template } from 'aws-cdk-lib/assertions'
import { App } from 'aws-cdk-lib'
import { FoundationStack } from '../../lib/foundation'
import helpers = require('../helpers')

describe('FoundationStack', () => {
  describe('VPC', () => {
    describe('when not given an existing VPC', () => {
      const stack = () => {
        const app = new App()
        return new FoundationStack(app, 'MyTestStack', {
          domainName: 'test.edu',
        })
      }

      test('creates a VPC', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.resourceCountIs('AWS::EC2::VPC', 1)
      })

      test('creates an internet gateway', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.resourceCountIs('AWS::EC2::InternetGateway', 1)
      })

      test('creates two private subnets and two public subnets', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.hasResourceProperties('AWS::EC2::Subnet', {
          AvailabilityZone: {
            "Fn::Select": [0, { "Fn::GetAZs": "" }],
          },
          "MapPublicIpOnLaunch": false,
        })
       template.hasResourceProperties('AWS::EC2::Subnet', {
          AvailabilityZone: {
            "Fn::Select": [1, { "Fn::GetAZs": "" }],
          },
          "MapPublicIpOnLaunch": false,
        })
       template.hasResourceProperties('AWS::EC2::Subnet', {
          AvailabilityZone: {
            "Fn::Select": [0, { "Fn::GetAZs": "" }],
          },
          "MapPublicIpOnLaunch": true,
        })
       template.hasResourceProperties('AWS::EC2::Subnet', {
          AvailabilityZone: {
            "Fn::Select": [1, { "Fn::GetAZs": "" }],
          },
          "MapPublicIpOnLaunch": true,
        })
      })

      test('creates a NAT gateway for each public subnet', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.hasResourceProperties('AWS::EC2::NatGateway', {
          "SubnetId": {
            "Ref": "VPCPublicSubnet1SubnetB4246D30",
          },
        })
       template.hasResourceProperties('AWS::EC2::NatGateway', {
          "SubnetId": {
            "Ref": "VPCPublicSubnet2Subnet74179F39",
          },
        })
      })
    })

    describe('when given an existing VPC', () => {
      beforeEach(() => {
        helpers.mockVpcFromLookup()
      })

      const stack = () => {
        const app = new App()
        return new FoundationStack(app, 'MyTestStack', {
          domainName: 'test.edu',
          useVpcId: 'abc123',
        })
      }

      test('does not create a VPC', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.resourceCountIs('AWS::EC2::VPC', 0)

      })

      test('does not create an internet gateway', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.resourceCountIs('AWS::EC2::InternetGateway', 0)
      })

      test('does not create any subnets', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.resourceCountIs('AWS::EC2::Subnet', 0)
      })

      test('creates a NAT gateway for each public subnet', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.resourceCountIs('AWS::EC2::NatGateway', 0)
      })
    })
  })

  describe('Domain', () => {
    describe('when useExistingDnsZone is false', () => {
      const stack = () => {
        const app = new App()
        return new FoundationStack(app, 'MyTestStack', {
          domainName: 'test.edu',
          useExistingDnsZone: false,
        })
      }

      test('creates a wildcard certificate for the domain using the zone as validation', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.hasResourceProperties('AWS::CertificateManager::Certificate', {
          DomainName: '*.test.edu',
          DomainValidationOptions: [{
            DomainName: '*.test.edu',
            HostedZoneId: {
              Ref: "HostedZoneDB99F866",
            },
          }],
          ValidationMethod: "DNS",
        })
      })

      test('creates a Route53 for the domain', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.hasResourceProperties('AWS::Route53::HostedZone', {
          Name: 'test.edu.',
        })
      })
    })

    describe('when useExistingDnsZone is true', () => {
      beforeEach(() => {
        helpers.mockHostedZoneFromLookup()
      })

      const stack = () => {
        const app = new App()
        return new FoundationStack(app, 'MyTestStack', {
          domainName: 'test.edu',
          useExistingDnsZone: true,
        })
      }

      test('creates a wildcard certificate for the domain using DNS validation', () => {
        const subject = stack()
        // THEN
        /* https://docs.aws.amazon.com/cdk/api/latest/docs/aws-cdk-lib_aws-certificatemanager.CertificateValidation.html
        IMPORTANT: If hostedZone is not specified, DNS records must be added manually and the stack will not complete creating until the records are added. 
        */
        const template = Template.fromStack(subject)
        template.hasResourceProperties('AWS::CertificateManager::Certificate', {
          DomainName: '*.test.edu',
          ValidationMethod: "DNS",
        })
      })

      test('does not create a Route53 for the domain', () => {
        const subject = stack()
        const template = Template.fromStack(subject)
        template.resourceCountIs('AWS::Route53::HostedZone', 0)
      })

    })
  })
 
  describe('Cluster', () => {
    test('creates a cluster', () => {
      const app = new App()
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
      })
      // THEN
      const template = Template.fromStack(stack)
      template.resourceCountIs('AWS::ECS::Cluster', 1)
    })
  })

  describe('Logs', () => {
    test('creates a shared log bucket with 90 day retention and one version for backup', () => {
      const app = new App()
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
      })
      // THEN
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::S3::Bucket', {
        AccessControl: "LogDeliveryWrite",
        LifecycleConfiguration: {
          Rules: [{
            Status: "Enabled",
            ExpirationInDays: 90,
            NoncurrentVersionExpirationInDays: 1,
          }],
        },
      })
    })

    test('creates a shared log group with one year retention', () => {
      const app = new App()
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
      })
      // THEN
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 365,
      })
    })
  })

  describe('Public S3 Bucket', () => {
    test('creates an s3 bucket that is accessible to specific sites', () => {
      const app = new App()
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
      })
      // THEN
      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::S3::Bucket', {
        CorsConfiguration: {
          CorsRules: [
            {
              AllowedHeaders: [
                "*",
              ],
              AllowedMethods: [
                "GET",
              ],
              AllowedOrigins: [
                "*.test.edu",
              ],
              MaxAge: 3600,
            },
          ],
        },
        LoggingConfiguration: {
          DestinationBucketName: {
            Ref: "LogBucketCC3B17E8",
          },
          LogFilePrefix: "s3/data-broker/",
        },
        WebsiteConfiguration: {
          IndexDocument: "index.html",
        },
      })

    })
  })
})