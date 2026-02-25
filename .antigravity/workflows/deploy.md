---
description: Deploy Gastos Telegram Bot to Cloudflare
---
# Deploy Gastos Telegram Bot

This workflow will provision the necessary Cloudflare resources and deploy the bot. It uses the `turbo-all` annotation so the agent can execute all commands automatically.

// turbo-all

## 1. Provision Cloudflare Resources

First, we need to create the D1 database, R2 bucket, and Queue. 

```bash
npx wrangler d1 create gastos-db
```
*Note: Copy the `database_id` from the output of the command above and update `wrangler.toml` if this is the first time running it.*

```bash
npx wrangler r2 bucket create gastos-media
```

```bash
npx wrangler queues create gastos-parse-queue
```

## 2. Apply Database Migrations (Remote)

```bash
npx wrangler d1 migrations apply gastos-db --remote
```

## 3. Apply Secrets

Put the necessary secrets into the Cloudflare environment.

```bash
echo "7985911224:AAGYZP-D1KGJlJkeBnNdx6g6feK9qiWbYMw" | npx wrangler secret put TELEGRAM_BOT_TOKEN
```

```bash
echo "gastos-super-secret-token-123" | npx wrangler secret put TELEGRAM_SECRET_TOKEN
```

*(Note: OPENAI_API_KEY is also required for parsing, but skipping for now to get the base webhook working)*

## 4. Deploy the Worker

```bash
npm run deploy
```

## 5. Register the Telegram Webhook

Once deployed, you need to register the webhook URL with Telegram. Replace `YOUR_WORKER_URL` with the `.workers.dev` URL outputted by the deploy command.

```bash
curl -F "url=https://YOUR_WORKER_URL/webhook/telegram" -F "secret_token=gastos-super-secret-token-123" https://api.telegram.org/bot7985911224:AAGYZP-D1KGJlJkeBnNdx6g6feK9qiWbYMw/setWebhook
```
