import { Match, Template } from 'aws-cdk-lib/assertions'
import { App } from 'aws-cdk-lib'
import { FoundationStack } from '../../lib/foundation'
import { MultimediaAssetsStack } from '../../lib/multimedia-assets'

describe('MultimediaAssetsStack', () => {
  const env = {
    account: '123456789',
    region: 'us-east-1',
  }
  const domainName = 'fake.domain'

  const app = new App()
  const foundationStack = new FoundationStack(app, 'FoundationStack', {
    env,
    domainName,
  })
  const stack = new MultimediaAssetsStack(app, 'TestStack', {
    env,
    foundationStack,
    domainName,
    namespace: 'my-happy-place',
    cacheTtl: 9001,
    stackName: 'test-stack-name',
    marbleContentBucketName: 'libnd-smb-marble',
    hostedZoneTypes: ['public'],
  })

  test('creates an s3 bucket for assets', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::S3::Bucket', {
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
          'Fn::ImportValue': Match.stringLikeRegexp('^FoundationStack:ExportsOutputRefLogBucket*'),
        },
        LogFilePrefix: 's3/data-broker/',
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })

  test('creates a cloudfront with an appropriate domain name', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
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
            'Fn::ImportValue': Match.stringLikeRegexp('^FoundationStack:ExportsOutputRefSsmParameterValuealldns*'),
          },
        },
      },
    })
  })

  test('creates a route53 record for the domain', () => {
    const template = Template.fromStack(stack)
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'my-happy-place-multimedia.fake.domain.',
      Type: 'CNAME',
      Comment: 'my-happy-place-multimedia.fake.domain',
      HostedZoneId: {
        'Ref': Match.stringLikeRegexp('^SsmParameterValuealldnsfakedomainpubliczone*'),
      },
      ResourceRecords: [
        {
          'Fn::GetAtt': ['DistributionCFDistribution882A7313', 'DomainName'],
        },
      ],
      TTL: '900',
    })
  })
})
