#!/usr/bin/env node
import { App } from '@aws-cdk/core'
import { StackTags } from '@ndlib/ndlib-cdk'
import 'source-map-support/register'
import { getRequiredContext } from '../lib/context-helpers'
import * as services from './services'
import * as pipelines from './codepipelines'

const app = new App()

const stackType = getRequiredContext(app.node, 'stackType')
const namespace = getRequiredContext(app.node, 'namespace')
const envName = getRequiredContext(app.node, 'env')
const contextEnv = getRequiredContext(app.node, 'environments')[envName]
if(contextEnv === undefined || contextEnv === null) {
  throw new Error(`Context key 'environments.${envName}' is required.`)
}
const env = { account: contextEnv.account, region: contextEnv.region, name: envName }

switch(stackType) {
  case 'service':
    services.instantiateStacks(app, namespace, env, contextEnv, envName)
    break
  case 'pipeline':
    pipelines.instantiateStacks(app, namespace, env, contextEnv, envName)
    break
  default:
    throw new Error(`Context key stackType must be on of 'service' or 'pipelines'. Got ${stackType}.`)
}
app.node.applyAspect(new StackTags())
