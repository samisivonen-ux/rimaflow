#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-rimaflow}"
REGION="${AWS_REGION:-eu-north-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET_NAME="${BUCKET_NAME:-rimaflow-${ACCOUNT_ID}-${REGION}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}"

if [[ ! -f "${ROOT_DIR}/app/index.html" || ! -f "${ROOT_DIR}/app/app.js" || ! -f "${ROOT_DIR}/app/style.css" ]]; then
  echo "VIRHE: app/index.html, app/app.js tai app/style.css puuttuu."
  echo "Aja deploy rimaflow2-kansion juuresta, jossa ovat app/, aws/ ja deploy.sh."
  exit 1
fi

if ! grep -q "RimaFlow 2.0 optimized" "${ROOT_DIR}/app/index.html"; then
  echo "VIRHE: Tämä ei näytä olevan RimaFlow 2.0 optimized -paketti."
  echo "index.html ei sisällä tekstiä: RimaFlow 2.0 optimized"
  exit 1
fi

echo "Deploy stack: ${STACK_NAME}"
echo "Region:       ${REGION}"
echo "Bucket:       ${BUCKET_NAME}"
echo "Local app:    ${ROOT_DIR}/app"
echo "Version:      $(grep -o 'RimaFlow 2.0 optimized' "${ROOT_DIR}/app/index.html" | head -1) / force upload"

aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${ROOT_DIR}/aws/cloudformation.yml" \
  --parameter-overrides "SiteBucketName=${BUCKET_NAME}" \
  --region "${REGION}" \
  --no-fail-on-empty-changeset

BUCKET="$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)"

DISTRIBUTION_ID="$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)"

SITE_URL="$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" \
  --output text)"

echo "Force upload static assets..."
aws s3 sync "${ROOT_DIR}/app" "s3://${BUCKET}" \
  --delete \
  --cache-control "no-store, no-cache, must-revalidate, max-age=0"

# Pakotetaan ylikirjoitus myös silloin, jos sync vertaa aikaleimoja harhaan.
aws s3 cp "${ROOT_DIR}/app" "s3://${BUCKET}" \
  --recursive \
  --cache-control "no-store, no-cache, must-revalidate, max-age=0"

echo "Verify uploaded index..."
aws s3 cp "s3://${BUCKET}/index.html" - | grep -q "RimaFlow 2.0 optimized"

echo "Invalidate CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths "/*" >/dev/null

echo
echo "Valmis. Avaa iPhonella:"
echo "${SITE_URL}?v=2-optimized-force2"
echo
echo "Jos kotinäyttö-appi näyttää vanhaa: sulje appi kokonaan ja avaa yllä oleva URL ensin Safarissa."
