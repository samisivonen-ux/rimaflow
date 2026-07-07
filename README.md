# RimaFlow 2.0 optimized

**RimaFlow** is a mobile-first PWA for cutting porch slats in field conditions.

Version shown in app:

```text
RimaFlow 2.0 optimized
by SSI 2026
build: force2
```

The app guides the worker one cut at a time:

1. measure the full-length batten in centimeters,
2. enter the measured length,
3. follow the instruction: cut X cm,
4. place the cut piece into the specified pile,
5. confirm success or mark the current batten as failed/incomplete.

The optimization is dynamic: after each cut, the remaining cuts are recalculated against the remaining measured stock length.

## Contents

```text
app/                  Static PWA app
aws/                  CloudFormation for S3 + CloudFront hosting
data/                 Original and generated Excel files
docs/                 GitHub publishing instructions
tools/                Plan schema and sample CSV
deploy.sh             AWS deployment script
github-publish.sh     GitHub repository creation + push script
.gitignore            Git ignore rules
```

## Deploy to existing AWS stack

```bash
cd rimaflow_deploy
chmod +x deploy.sh
AWS_REGION=eu-north-1 STACK_NAME=kuisti-rimaflow ./deploy.sh
```

Known CloudFront URL from the first deployment:

```text
https://d3tkr345snrmvs.cloudfront.net
```

## Publish to GitHub

Default target repository:

```text
samisivonen-ux/rimaflow
```

Publish:

```bash
cd rimaflow_deploy
chmod +x github-publish.sh
gh auth login
./github-publish.sh
```

Publish as private:

```bash
VISIBILITY=private ./github-publish.sh
```

After publishing:

```bash
gh repo view samisivonen-ux/rimaflow --web
```

## Included Excel files

```text
data/mokin_kuistin_ritilat_alkuperainen.xlsx
data/mokin_kuistin_ritilat_sahaussuunnitelma.xlsx
```

## Changing the plan

Replace `app/plan.json` with another plan that follows `tools/plan-schema.json`, then redeploy.

