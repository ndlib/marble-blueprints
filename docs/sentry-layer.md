# Sentry Layer
tl;dr - AWS Lambda Layer for Sentry dependencies.

A [layer](https://docs.aws.amazon.com/lambda/latest/dg/configuration-layers.html) is a ZIP archive that contains libraries, a custom runtime, or other dependencies. With layers, you can use libraries in your function without needing to include them in your deployment package.

[Sentry](sentry.io) provides error monitoring that helps all software teams discover, triage, and prioritize errors in real-time.

This layer contains Sentry v0.13.2 and its dependencies. You'll need to create an S3 bucket for the zip, but the name isn't important just that the deploy script can read/write to it.

## Create and Deploy Layer
To create a new layer or new version of an existing layer
```
cd /deploy/cloudformation/layers/sentry/
./deploy.sh <BUCKET_NAME> <STACK_NAME>

./deploy.sh my_bucket marble-sentry
```

## Update Manifest Pipeline with newer layer
Once you have created and deployed a layer you'll want to utilize it in the manifest pipeline. Redeploy the manifest pipeline stack with the updated layer version.
```
aws cloudformation deploy \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --stack-name marble-manifest-deployment \
  --template-file deploy/cloudformation/manifest-pipeline-pipeline.yml \
  --parameter-overrides GitHubToken=my_oauth_key ContactTag=me@myhost.com OwnerTag=me \
    TestHostnamePrefix='marble-manifest-test' ProdHostnamePrefix='marble-manifest' \
    SentryDsn='https://123456789@sentry.io/123456789'
```