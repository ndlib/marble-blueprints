PROGNAME=$0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

usage() {
  cat << EOF >&2
Usage: $PROGNAME stage

Deployes the pipeline to the stage
Note: Ensure you have an env variable S3_BUCKET as the bucket to deploy to.

EOF
  exit 1
}
``
stage=$1
path=$2

if [ -z ${S3_BUCKET+x} ]; then
  usage
  exit 1
fi

export CODEBUILD_SRC_DIR=`pwd`/$path
export CODEBUILD_SRC_DIR_ConfigCode=`pwd`/../

pushd .

cd $path
./scripts/codebuild/install.sh
./scripts/codebuild/pre_build.sh
./scripts/codebuild/build.sh
./scripts/codebuild/post_build.sh

# aws cloudformation deploy --template-file output.yml --stack-name mellon-manifest-pipeline-$staged

popd
