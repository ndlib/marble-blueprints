import { expect as expectCDK, haveResourceLike, stringLike } from '@aws-cdk/assert'
import cdk = require('@aws-cdk/core')
import { FoundationStack } from '../../lib/foundation'
import { MultimediaAssetsStack } from '../../lib/multimedia-assets'

describe('MultimediaAssetsStack', () => {
  const env = {
    account: '123456789',
    region: 'us-east-1',
  }
  const domainName = 'fake.domain'

  const app = new cdk.App()
  const foundationStack = new FoundationStack(app, 'FoundationStack', {
    env,
    domainName,
  })
  const stack = new MultimediaAssetsStack(app, 'TestStack', {
    env,
    foundationStack,
    domainName,
    createDns: true,
    namespace: 'my-happy-place',
    cacheTtl: 9001,
    stackName: 'test-stack-name',
    marbleContentBucketName: 'libnd-smb-marble',
  })

  test('creates an s3 bucket for assets', () => {
    expectCDK(stack).to(
      haveResourceLike('AWS::S3::Bucket', {
        BucketName: 'my-happy-place-multimedia-123456789',
        CorsConfiguration: {
          CorsRules: [
            {
              AllowedHeaders: [
                '*',
              ],
              AllowedMethods: [
                'GET',
              ],
              AllowedOrigins: [
                '*.fake.domain',
              ],
              MaxAge: 3600,
            },
          ],
        },
        LoggingConfiguration: {
          DestinationBucketName: {
            'Fn::ImportValue': stringLike('FoundationStack:ExportsOutputRefLogBucket*'),
          },
          LogFilePrefix: 's3/data-broker/',
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      }),
    )
  })

  test('creates a cloudfront with an appropriate domain name', () => {
    expectCDK(stack).to(
      haveResourceLike('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Aliases: [
            'my-happy-place-multimedia.fake.domain',
          ],
          DefaultCacheBehavior: {
            DefaultTTL: 9001,
            ViewerProtocolPolicy: 'redirect-to-https',
          },
          ViewerCertificate: {
            AcmCertificateArn: {
              'Fn::ImportValue': stringLike('FoundationStack:ExportsOutputRefCertificate*'),
            },
          },
        },
      }),
    )
  })

  test('creates a route53 record for the domain', () => {
    expectCDK(stack).to(
      haveResourceLike('AWS::Route53::RecordSet', {
        Name: 'my-happy-place-multimedia.fake.domain.',
        Type: 'CNAME',
        HostedZoneId: {
          'Fn::ImportValue': stringLike('FoundationStack:ExportsOutputRefHostedZone*'),
        },
        ResourceRecords: [
          {
            'Fn::GetAtt': ['DistributionCFDistribution882A7313', 'DomainName'],
          },
        ],
      }),
    )
  })
})
