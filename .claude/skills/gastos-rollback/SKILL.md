---
name: gastos-rollback
description: Roll back a Cloudflare Workers deployment. Use when production is broken, deployment caused issues, need to revert, or user says something like "roll back", "revert deploy", or "shit's broken".
tools: Bash
disable-model-invocation: true
---

# Deployment Rollback

Emergency rollback procedure for Cloudflare Workers deployments.

## Step 1: Show recent deployments

Run:
```bash
npx wrangler deployments list
```

Show the user the list and identify the current vs. previous deployment.

## Step 2: Confirm rollback target

Ask the user which version to roll back to. Default to the immediately previous version if they don't specify.

## Step 3: Execute rollback

Run:
```bash
npx wrangler rollback <version-id> -m "<reason>" -y
```

Where:
- `<version-id>` is the deployment version ID from step 1
- `<reason>` is a brief description of why (e.g., "broken expense logging after deploy")

## Step 4: Verify rollback

Run:
```bash
npx wrangler deployments status
```

Confirm the active deployment is now the rolled-back version.

## Step 5: Report

Tell the user:
- Which version is now active
- What the rolled-back version was
- Suggest investigating the issue before redeploying
