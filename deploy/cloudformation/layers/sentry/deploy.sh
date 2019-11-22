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

echo "${magenta}----- SENDING ARTIFACT TO S3 -----${reset}"
OUTPUT_TEMPLATE="sentry.yml"
aws cloudformation package \
    --region ${REGION} \
    --template-file ./template.yml \
    --s3-bucket ${ARTIFACT_BUCKET} \
    --output-template-file ${OUTPUT_TEMPLATE}

echo "${magenta}----- CREATING LAYER -----${reset}"
aws cloudformation deploy \
    --region ${REGION} \
    --capabilities CAPABILITY_IAM \
    --stack-name ${STACK_NAME} \
    --template-file ${OUTPUT_TEMPLATE} \
    --parameter-overrides ArtifactBucket=${ARTIFACT_BUCKET}

echo "${magenta}----- CLEAN-UP -----${reset}"
rm -rf python
rm ${OUTPUT_TEMPLATE}
