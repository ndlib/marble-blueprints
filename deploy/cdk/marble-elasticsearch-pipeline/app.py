#!/usr/bin/env python

from aws_cdk import core
from marble_elasticsearch_pipeline.marble_elasticsearch_pipeline_stack import MarbleElasticsearchPipelineStack


app = core.App()
meps = MarbleElasticsearchPipelineStack(app, "marble-elasticsearch-pipeline")
meps.add_stages()
app.synth()
