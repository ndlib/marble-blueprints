#!/bin/bash

magenta=`tput setaf 5`
reset=`tput sgr0`

ARTIFACT_BUCKET=""
STACK_NAME="marble-manifest-layer"
REGION="us-east-1"

rm -rf python
mkdir -p python

echo "${magenta}----- GENERATING DEPENDENCIES -----${reset}"
pushd python
pip install -r ../requirements.txt -t .
rm -rf *dist-info
popd

echo "${magenta}----- SENDING ZIP TO S3 -----${reset}"
zip -r9 layer.zip python
aws s3 mv layer.zip s3://${ARTIFACT_BUCKET}/layer.zip

echo "${magenta}----- CREATING LAYER -----${reset}"
aws --region ${REGION} cloudformation deploy \
    --capabilities CAPABILITY_IAM \
    --stack-name ${STACK_NAME} \
    --template-file sentry.yml \
    --parameter-overrides ArtifactBucket=${ARTIFACT_BUCKET}

echo "${magenta}----- CLEAN-UP -----${reset}"
rm -rf python
