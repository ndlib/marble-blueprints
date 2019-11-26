# Sentry Layer
tl;dr - AWS Lambda Layer for Sentry dependencies.

A [layer](https://docs.aws.amazon.com/lambda/latest/dg/configuration-layers.html) is a ZIP archive that contains libraries, a custom runtime, or other dependencies. With layers, you can use libraries in your function without needing to include them in your deployment package.

[Sentry](sentry.io) provides error monitoring that helps all software teams discover, triage, and prioritize errors in real-time.

This layer contains Sentry v0.13.2 and its dependencies.

## Create and Deploy Layer
To create a new layer or new version of an existing layer
```
deploy.sh <BUCKET_NAME> <STACK_NAME>
```

## Update Manifest Pipeline with newer layer
Once you have created and deployed a layer you'll want to utilize it in the manifest pipeline.
Simply bump the layer version to match the latest deployed in manifest-pipeline.yml and redeploy the manifest pipeline stack.
```
!Sub arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:layer:${SentryLayer}:5
```