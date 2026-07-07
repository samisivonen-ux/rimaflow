# GitHub setup for RimaFlow

This folder is ready to publish as:

```text
samisivonen-ux/rimaflow
```

## 1. Check GitHub CLI

```bash
gh --version
```

If missing:

```bash
brew install gh
```

## 2. Login

```bash
gh auth login
```

Choose:

```text
GitHub.com
HTTPS
Login with a web browser
```

## 3. Publish repository

From this folder:

```bash
cd ~/Downloads/rimaflow_deploy
chmod +x github-publish.sh
./github-publish.sh
```

Private repository:

```bash
VISIBILITY=private ./github-publish.sh
```

## 4. Verify

```bash
gh repo view samisivonen-ux/rimaflow
gh repo view samisivonen-ux/rimaflow --web
```

## 5. Existing repository case

If the repository already exists, the script will reuse it and push the current folder contents to `main`.

