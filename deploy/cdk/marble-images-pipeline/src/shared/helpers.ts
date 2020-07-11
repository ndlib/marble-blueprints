import { CfnResource } from '@aws-cdk/core'
import cdk = require('@aws-cdk/core')

export default class Helpers {
  // Convenience method. Used since the high-level constructs do not have a way to override logical ids, and we need
  // to match what the cloudformation ids were.
  public static overrideLogicalId = (construct: cdk.Construct, newId?: string) => {
    const cfn = construct.node.defaultChild as CfnResource
    cfn.overrideLogicalId(newId ? newId : construct.node.id)
  }
}
