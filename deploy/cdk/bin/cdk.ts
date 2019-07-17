#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { NetworkStack } from '../lib/network';

const app = new cdk.App();
new NetworkStack(app, 'Network');
