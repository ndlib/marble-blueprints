#!/usr/bin/env node
import { App, Aspects } from 'aws-cdk-lib'
import { StackTags } from '@ndlib/ndlib-cdk2'
import 'source-map-support/register'
import { getRequiredContext } from '../lib/context-helpers'
import * as services from './services'
import * as pipelines from './codepipelines'
import { ContextEnv } from '../lib/context-env'

const app = new App()

const stackType = getRequiredContext(app.node, 'stackType')
const namespace = getRequiredContext(app.node, 'namespace')
const envName = getRequiredContext(app.node, 'env')
const contextEnv = ContextEnv.fromContext(app.node, envName)

switch(stackType) {
  case 'service':
    services.instantiateStacks(app, namespace, contextEnv)
    break
  case 'pipeline':
    {
      // We need to instantiate all test and prod stacks here, in the same way that the pipelines
      // will deploy them. This is just so that cdk will be aware of the dependencies and create
      // the required exports on the foundation stacks. It's a bit heavy handed, and will add a
      // lot of stacks to the output of 'cdk list -c stackType=pipeline' but I don't know of
      // a better way to force cdk to create all of the expected exports.
      const testStacks = services.instantiateStacks(app, `${namespace}-test`, contextEnv)
      const prodStacks = services.instantiateStacks(app, `${namespace}-prod`, contextEnv)
      pipelines.instantiateStacks(app, namespace, contextEnv, testStacks, prodStacks)
    }
    break
  default:
    throw new Error(`Context key stackType must be on of 'service' or 'pipeline'. Got ${stackType}.`)
}

Aspects.of(app).add(new StackTags())
