#!/bin/bash
# Usage: ./scripts/check-webhook.sh <BOT_TOKEN>
# Or to re-register: ./scripts/check-webhook.sh <BOT_TOKEN> <WEBHOOK_SECRET>

BOT_TOKEN="$1"
WEBHOOK_SECRET="$2"
WEBHOOK_URL="https://gastos-telegram-bot.edrianbertulfo.workers.dev/webhook/telegram"

if [ -z "$BOT_TOKEN" ]; then
  echo "Usage: ./scripts/check-webhook.sh <BOT_TOKEN> [WEBHOOK_SECRET]"
  echo ""
  echo "  No args:           shows current webhook info"
  echo "  With secret:       re-registers webhook with secret_token"
  exit 1
fi

echo "=== Webhook Info ==="
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool

if [ -n "$WEBHOOK_SECRET" ]; then
  echo ""
  echo "=== Re-registering webhook ==="
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"${WEBHOOK_URL}\", \"secret_token\": \"${WEBHOOK_SECRET}\"}" | python3 -m json.tool
fi
