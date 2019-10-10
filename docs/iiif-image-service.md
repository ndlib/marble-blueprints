# IIIF Image Service
This will create the infrastructure to host a [IIIF Image Service](https://github.com/nulib/serverless-iiif).

## Continuous Delivery Pipeline
This will create a CodePipeline that will monitor Github for changes and deploy those changes to a test stack, then to a production stack.

Before you deploy, review your current [context](https://docs.aws.amazon.com/cdk/latest/guide/context.html):
```console
cdk context
```

Deploy the pipeline stack:
```console
cdk deploy marble-iiif-serverless-deployment
```
