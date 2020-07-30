import { expect as expectCDK, haveResource, haveResourceLike, MatchStyle, matchTemplate } from '@aws-cdk/assert';
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
    describe('when doCreateZone is true', () => {
      test('creates a wildcard certificate for the domain using the zone as validation', () => {
        const app = new cdk.App();
        // WHEN
        const stack = new FoundationStack(app, 'MyTestStack', {
          domainName: 'test.edu',
          doCreateZone: true,
        });
        // THEN
        expectCDK(stack).to(haveResourceLike('AWS::CertificateManager::Certificate', {
          DomainName: '*.test.edu',
          DomainValidationOptions: [{
            DomainName: '*.test.edu',
            HostedZoneId: {
              Ref: "HostedZoneDB99F866"
            }
          }],
          ValidationMethod: "DNS",
        }));
      });

      test('creates a Route53 for the domain', () => {
        const app = new cdk.App();
        // WHEN
        const stack = new FoundationStack(app, 'MyTestStack', {
          domainName: 'test.edu',
          doCreateZone: true,
        });
        // THEN
        expectCDK(stack).to(haveResourceLike('AWS::Route53::HostedZone', {
          Name: 'test.edu.',
        }));
      });
    });

    describe('when doCreateZone is false', () => {
      test('creates a wildcard certificate for the domain using DNS validation', () => {
        const app = new cdk.App();
        // WHEN
        const stack = new FoundationStack(app, 'MyTestStack', {
          domainName: 'test.edu',
          doCreateZone: false,
        });
        // THEN
        /* https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-certificatemanager.CertificateValidation.html
        IMPORTANT: If hostedZone is not specified, DNS records must be added manually and the stack will not complete creating until the records are added. 
        */
        expectCDK(stack).to(haveResourceLike('AWS::CertificateManager::Certificate', {
          DomainName: '*.test.edu',
          ValidationMethod: "DNS",
        }));
      });

      test('does not create a Route53 for the domain', () => {
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
 
  describe('Cluster', () => {
    test('creates a cluster', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
        doCreateZone: false,
      });
      // THEN
      expectCDK(stack).to(haveResource('AWS::ECS::Cluster'));
    });
  });

  describe('Logs', () => {
    test('creates a shared log bucket with ten year retention and one version for backup', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
        doCreateZone: false,
      });
      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::S3::Bucket', {
        AccessControl: "LogDeliveryWrite",
        LifecycleConfiguration: {
          Rules: [{
            Status: "Enabled",
            ExpirationInDays: 3650,
            NoncurrentVersionExpirationInDays: 1,
          }]
        }
      }));
    });

    test('creates a shared log group with one year retention', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
        doCreateZone: false,
      });
      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::Logs::LogGroup', {
        RetentionInDays: 365,
      }));
    });
  });

  describe('Public S3 Bucket', () => {
    test('creates an s3 bucket that is accessible to specific sites', () => {
      const app = new cdk.App();
      // WHEN
      const stack = new FoundationStack(app, 'MyTestStack', {
        domainName: 'test.edu',
        doCreateZone: false,
      });
      // THEN
      expectCDK(stack).to(haveResourceLike('AWS::S3::Bucket', {
        CorsConfiguration: {
          CorsRules: [
            {
              AllowedHeaders: [
                "*"
              ],
              AllowedMethods: [
                "GET"
              ],
              AllowedOrigins: [
                "*.library.nd.edu",
                "*.libraries.nd.edu",
                "*.cloudfront.net",
                "http://universalviewer.io"
              ],
              MaxAge: 3600
            }
          ]
        },
        LoggingConfiguration: {
          DestinationBucketName: {
            Ref: "LogBucketCC3B17E8"
          },
          LogFilePrefix: "s3/data-broker/"
        },
        WebsiteConfiguration: {
          IndexDocument: "index.html"
        }
      }));

    });
  });
});