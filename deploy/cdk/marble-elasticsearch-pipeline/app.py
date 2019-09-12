#!/usr/bin/env python

from aws_cdk import core
from marble_elasticsearch_pipeline.marble_elasticsearch_pipeline_stack import MarbleElasticsearchPipelineStack
import json

with open('repo.json') as repo_file:
    repo = json.load(repo_file)
    repo_name = repo.get('repo_name', 'marble-elasticsearch')
    repo_branch = repo.get('repo_branch', 'master')
    repo_owner = repo.get('repo_owner', 'ndlib')

app = core.App()
meps = MarbleElasticsearchPipelineStack(app, "marble-elasticsearch-pipeline",
                                        repo_branch, repo_name, repo_owner)
meps.add_stages()
