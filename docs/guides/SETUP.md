# Setup

## 1. Install dependencies

```bash
npm install
```

## 2. Create Cloudflare resources

- D1 database named `gastos`
- Queue named `gastos-parse-jobs`
- R2 bucket named `gastos-media`

Update `/Users/edrianbertulfo/Dev/gastos-telegram-bot/wrangler.toml` with your real D1 `database_id`.

## 3. Configure secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put OPENAI_API_KEY
```

Do not store production tokens in `wrangler.toml`.

## 4. Apply migrations

```bash
wrangler d1 migrations apply gastos --local
```

## 5. Run locally

```bash
npm run dev
```

## 6. Run tests

```bash
npm run test
```

## 7. Deploy

```bash
npm run deploy
```
