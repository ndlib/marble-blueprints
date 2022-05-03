import { Fn, StackProps, Stack } from "aws-cdk-lib"
import {
  SLOAlarms,
  SLOAlarmsDashboard,
  SLOPerformanceDashboard,
} from "@ndlib/ndlib-cdk2"
import { CfnDashboard } from "aws-cdk-lib/aws-cloudwatch"
import * as subs from "aws-cdk-lib/aws-sns-subscriptions"
import { AnySLO } from "@ndlib/ndlib-cdk2/lib/slos/types"
import { Construct } from "constructs"
import { ServiceStacks } from "../types"

export interface IServiceLevelsStackProps extends StackProps {
  readonly slos: AnySLO[]

  /**
   * Who to send alarms to
   */
  readonly emailSubscriber: string

  /**
   * Link to the defined SLOs
   */
  readonly sloDocLink: string

  /**
   * Link to the runbook for these services
   */
  readonly runbookLink: string

  /**
   * Link to the primary debug dashboard
   */
  readonly debugDashboardLink: string

  /**
   * What to name the alarms dashboard
   * Default: "SLO-Alarms-Marble"
   */
  readonly alarmsDashboardName?: string

  /**
   * What to name the performance dashboard
   * Default: "SLO-Performance-Marble"
   */
  readonly performanceDashboardName?: string

  readonly services: ServiceStacks
}

export class ServiceLevelsStack extends Stack {
  constructor(scope: Construct, id: string, props: IServiceLevelsStackProps) {
    super(scope, id, props)

    const alarmsDash = new SLOAlarmsDashboard(this, "AlarmsDashboard", {
      slos: props.slos,
      dashboardName: props.alarmsDashboardName ?? "SLO-Alarms-Marble",
    })
    const perfDash = new SLOPerformanceDashboard(this, "PerformanceDashboard", {
      slos: props.slos,
      dashboardName: props.performanceDashboardName ?? "SLO-Performance-Marble",
    })

    const alarmsDashboardName = Fn.ref((alarmsDash.node.defaultChild as CfnDashboard).logicalId)
    const alarms = new SLOAlarms(this, "Alarms", {
      slos: props.slos,
      dashboardLink: props.debugDashboardLink,
      runbookLink: props.runbookLink,
      alarmsDashboardLink: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${alarmsDashboardName}`,
    })

    alarms.alarms.forEach((alarm) => (alarm.parentAlarm.alarmDescription += `SLOs: ${props.sloDocLink}\n`))
    alarms.topics.High.addSubscription(new subs.EmailSubscription(props.emailSubscriber))
    alarms.topics.Low.addSubscription(new subs.EmailSubscription(props.emailSubscriber))
  }
}
