#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { MarbleWebKioskExportStack } from '../lib/marble-web-kiosk-export-pipeline-stack';

const app = new cdk.App();
new MarbleWebKioskExportStack(app, 'marble-web-kiosk-export-pipeline');
