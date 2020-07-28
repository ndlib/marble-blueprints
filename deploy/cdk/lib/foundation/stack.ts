import { Vpc, IVpc } from "@aws-cdk/aws-ec2";
import { Construct, Stack, StackProps } from "@aws-cdk/core";

export interface IBaseStackProps extends StackProps {
  readonly domainName: string;
  readonly doCreateZone?: boolean;
}

export class FoundationStack extends Stack {
  public readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props: IBaseStackProps) {
    super(scope, id, props);
    
    this.vpc = new Vpc(this, 'VPC');
    
  }
}