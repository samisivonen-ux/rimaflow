#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-rimaflow}"
REGION="${AWS_REGION:-eu-north-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET_NAME="${BUCKET_NAME:-rimaflow-${ACCOUNT_ID}-${REGION}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${ROOT_DIR}/app/index.html" || ! -f "${ROOT_DIR}/app/app.js" || ! -f "${ROOT_DIR}/app/style.css" ]]; then
  echo "VIRHE: app/index.html, app/app.js tai app/style.css puuttuu."
  exit 1
fi

if ! grep -q "RimaFlow 2.0 optimized" "${ROOT_DIR}/app/index.html"; then
  echo "VIRHE: Tämä ei näytä olevan RimaFlow 2.0 optimized -paketti."
  exit 1
fi

aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${ROOT_DIR}/aws/cloudformation.yml" \
  --parameter-overrides "SiteBucketName=${BUCKET_NAME}" \
  --region "${REGION}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset

BUCKET="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --region "${REGION}" --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)"
DISTRIBUTION_ID="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --region "${REGION}" --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"
SITE_URL="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --region "${REGION}" --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text)"

aws s3 sync "${ROOT_DIR}/app" "s3://${BUCKET}" \
  --delete \
  --cache-control "no-cache"

aws s3 cp "s3://${BUCKET}/index.html" - | grep -q "RimaFlow 2.0 optimized"
aws cloudfront create-invalidation --distribution-id "${DISTRIBUTION_ID}" --paths "/*" >/dev/null

echo "Valmis: ${SITE_URL}"
