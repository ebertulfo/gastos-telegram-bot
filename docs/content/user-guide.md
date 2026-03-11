# Getting Started with Gastos

Gastos is an AI-powered expense tracker that lives in Telegram. Instead of opening an app and filling out forms, just send a message — text, photo, or voice — and your expense is tracked.

## Setting Up

1. Open Telegram and search for **@GastosBot** (or tap the bot link if you have one)
2. Tap **Start** or send `/start`
3. Choose your primary currency — tap one of the buttons (PHP, SGD, USD, EUR, etc.) or type any 3-letter currency code
4. Your timezone is set automatically based on your currency. Setup complete!

## Logging Expenses

Just tell the bot what you spent. There's no special format — talk to it like you'd tell a friend.

**Text messages:**
- `lunch 15.50`
- `grabbed coffee for 4.80`
- `grocery shopping at SM 2,350 pesos`
- `uber to airport 280`

**Multiple entries at once:**
- `lunch 12, coffee 4.50, parking 3`

**Photos:** Snap a receipt and send the photo. The bot reads it, extracts the amount, and logs it. Add a caption if you want (e.g., "dinner with friends").

**Voice messages:** Just say what you spent. The bot transcribes it and logs the expense. Example: *"Spent fifty bucks on gas this morning."*

The bot automatically categorizes each expense (Food, Transport, Housing, Shopping, Entertainment, Health, or Other) and adds relevant tags.

## Asking Questions

Ask anything about your spending in plain English:

- `How much did I spend this week?`
- `What did I spend on food last month?`
- `How much did I spend on drinks?` — finds Starbucks, Gatorade, beer, and anything else semantically related
- `Break down last month by category`
- `What were my biggest expenses this year?`

The bot remembers your recent conversation, so follow-ups work naturally:
- You: `What did I spend on food?`
- Bot: *Shows food expenses...*
- You: `Break that down by day`

## Quick Commands

For fast totals without waiting for AI processing:

| Command | Shows |
|---------|-------|
| `/today` | Today's total |
| `/yesterday` | Yesterday's total |
| `/thisweek` | This week (Mon-Sun) |
| `/lastweek` | Last week's total |
| `/thismonth` | This month's total |
| `/lastmonth` | Last month's total |
| `/thisyear` | This year's total |
| `/lastyear` | Last year's total |

These commands run instantly — pure database queries, no AI processing needed.

## Mini App

For a full dashboard experience without leaving Telegram, open the Gastos Mini App (tap the menu button in the bot chat).

**Dashboard** — Browse your expense list, see totals for any period, and edit or delete entries inline.

**Analytics** — Spending breakdown by category, week-over-week and month-over-month comparisons, and trend charts.

**Review Queue** — Some expenses get flagged as "needs review" when the AI isn't fully confident. Confirm, correct, or discard them here.

## Tips

- **Log as you go** or batch at the end of the day — both work great
- **Be natural** — the bot understands context, so "coffee 5" is just as good as "I spent 5 dollars on coffee at Starbucks"
- **Use voice** when your hands are full — after shopping, walking, driving
- **Check your totals** with quick commands for an instant snapshot without AI processing time
