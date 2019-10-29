import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Fn, Stack } from '@aws-cdk/core';

export enum GlobalActions {
  None,
  S3,
  Cloudfront,
  Route53,
}

export class NamespacedPolicy {
  // For actions that only support '*', ie cannot be namespaced
  public static globals(actionOptions: GlobalActions[]): PolicyStatement {
    let actions : string[] = [];
    if(actionOptions.includes(GlobalActions.S3)){
      actions.push('s3:CreateBucket');
    }
    if(actionOptions.includes(GlobalActions.Cloudfront)){
      actions = [...actions,
        'cloudfront:TagResource',
        'cloudfront:CreateDistribution',
        'cloudfront:GetDistribution',
        'cloudfront:UpdateDistribution',
        'cloudfront:DeleteDistribution',
        'cloudfront:CreateCloudFrontOriginAccessIdentity',
        'cloudfront:GetCloudFrontOriginAccessIdentity',
        'cloudfront:GetCloudFrontOriginAccessIdentityConfig',
        'cloudfront:UpdateCloudFrontOriginAccessIdentity',
        'cloudfront:DeleteCloudFrontOriginAccessIdentity',
      ];
    }
    if(actionOptions.includes(GlobalActions.Route53)){
      actions.push('route53:ListHostedZones');
    }
    
    return new PolicyStatement({
      resources: ['*'],
      actions,
    });
  }

  public static iamRole(stackName: string): PolicyStatement  {
    return new PolicyStatement({
      resources: [ Fn.sub('arn:aws:iam::${AWS::AccountId}:role/' + stackName + '*') ],
      actions: ['iam:*'],
    });
  }

  public static lambda(stackName: string): PolicyStatement {
    return new PolicyStatement({
      resources: [
        Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:' + stackName + '*'),
        Fn.sub('arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:layer:' + stackName + '*'),
      ],
      actions: ['lambda:*'],
    });
  }

  // This is sort of a global, but I don't want to put it in globals. Doing so
  // would give full permissions to domains, since domains are under apigateway actions.
  public static api(): PolicyStatement {
    return new PolicyStatement({
      resources: [
        Fn.sub('arn:aws:apigateway:${AWS::Region}::/restapis'),
        Fn.sub('arn:aws:apigateway:${AWS::Region}::/restapis/*'),
      ],
      actions: [
        'apigateway:*',
      ],
    });
  }

  public static apiDomain(domainName: string): PolicyStatement {
    return new PolicyStatement({
      resources: [
        Fn.sub('arn:aws:apigateway:${AWS::Region}::/domainnames'),
        Fn.sub('arn:aws:apigateway:${AWS::Region}::/domainnames/${domainName}', { domainName }),
        Fn.sub('arn:aws:apigateway:${AWS::Region}::/domainnames/${domainName}/*', { domainName }),
      ],
      actions: [
        'apigateway:POST',
        'apigateway:GET',
        'apigateway:DELETE',
      ],
    });
  }

  public static s3(stackName: string): PolicyStatement {
    return new PolicyStatement({
      resources: [ Fn.sub('arn:aws:s3:::' + stackName + '*') ],
      actions: ['s3:*'],
    });
  }

  public static transform(): PolicyStatement {
    return new PolicyStatement({
      resources: [ Fn.sub('arn:aws:cloudformation:${AWS::Region}:aws:transform/Serverless-2016-10-31') ],
      actions: ['cloudformation:CreateChangeSet'],
    });
  }

  public static route53RecordSet(zone: string): PolicyStatement {
    return new PolicyStatement({
      actions: [
        'route53:GetHostedZone',
        'route53:ChangeResourceRecordSets',
        'route53:GetChange',
      ],
      resources: [
        `arn:aws:route53:::hostedzone/${zone}`,
        'arn:aws:route53:::change/*',
      ],
    });
  };

  public static ssm(stackName: string): PolicyStatement {
    return new PolicyStatement({
      actions: [
        'ssm:*'
      ],
      resources: [
        Fn.sub('arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/all/stacks/' + stackName + '/*'),
      ],
    });
  };
}