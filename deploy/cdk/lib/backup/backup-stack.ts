import { BackupPlan, BackupResource, BackupVault } from "@aws-cdk/aws-backup"

import { StackProps, Construct, Stack } from "@aws-cdk/core"

export interface IBackupStackProps extends StackProps {
  readonly backupPlanName?: string
}

export class BackupStack extends Stack {
  constructor(scope: Construct, id: string, props: IBackupStackProps) {
    super(scope, id, props)

    const backupVault = new BackupVault(this, 'backup-vault', {})  /* Note that stack name is automatically prepended to the string name here */
    const backupPlanName = props.backupPlanName || `${this.stackName}-MarbleDynamoDbBackupPlan` /* Unlike above, I need to include stackName here to include it in the name */
    const backupPlan = BackupPlan.dailyMonthly1YearRetention(this, backupPlanName , backupVault)
    backupPlan.addSelection('DynamoTables', {
      resources: [
        BackupResource.fromTag('BackupMarbleDynamoDB', 'true'),
      ],
    })


  }
}
