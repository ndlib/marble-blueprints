# Pipeline Monitoring
Use this stack if you want to notify an email address of pipeline events. It is currently written to only accept a single email address, so it's recommended you use a mailing list for the Receivers parameter.

Here's an example of adding monitoring to the image-viewer-pipeline
```console
aws cloudformation deploy \
  --stack-name marble-image-viewer-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --parameter-overrides PipelineStackName=marble-image-webcomponent-pipeline Receivers=me@myhost.com
```

Here's an example of adding monitoring to the website-pipeline
```console
aws cloudformation deploy \
  --stack-name marble-website-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --parameter-overrides PipelineStackName=marble-website-pipeline Receivers=me@myhost.com
```

Here's an example of adding monitoring to the image-service-pipeline
```console
aws cloudformation deploy \
  --stack-name marble-image-service-pipeline-monitoring \
  --template-file deploy/cloudformation/pipeline-monitoring.yml \
  --parameter-overrides PipelineStackName=marble-image-service-pipeline Receivers=me@myhost.com
```

### Example of the notification:
>The pipeline marble-image-webcomponent-pipeline has changed state to STARTED. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

>The pipeline marble-image-webcomponent-pipeline has changed state to FAILED. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.

>The pipeline marble-image-webcomponent-pipeline has changed state to RESUMED. To view the pipeline, go to https://us-west-2.console.aws.amazon.com/codepipeline/home?region=us-west-2#/view/marble-image-webcomponent-pipeline-CodePipeline-ID.
