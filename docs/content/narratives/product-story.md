# Expense Tracking Shouldn't Require Opening an App

Gastos is an AI-powered expense tracker that lives in Telegram. Instead of opening an app and filling out forms, just send a message — text, photo, or voice — and your expense is tracked.

---

## The problem nobody talks about

Here's a dirty secret about expense tracking: most people who try it eventually stop.

Not because they don't care about their money. Not because the apps are bad. But because every expense tracker on the market turns logging into a production. Open the app. Tap the plus button. Pick a category from a dropdown. Type in the amount. Add a note if you're feeling ambitious. Save. Repeat forty times a day.

The popular apps — Mint, YNAB, Money Lover — they're powerful tools. They can budget, forecast, generate reports, sync your bank accounts. But that power comes with complexity. They try to do spending *and* budgeting at the same time, which makes sense on paper but turns a simple task into a system you have to learn. Suddenly expense tracking feels like homework.

My wife tracks our expenses in an Excel sheet. It works, honestly. She's disciplined about it. But it's tedious. You have to remember what you spent, open the spreadsheet, find the right row, type it all in. If you forget for a couple of days, you're now doing archaeology on your bank statement trying to reconstruct Tuesday's lunch.

The pattern is always the same: you start strong, life gets busy, and the friction wins. The app sits on your home screen collecting dust. The spreadsheet stops getting updated. You tell yourself you'll catch up this weekend. You won't.

The problem was never motivation. It was friction. ([read more](../decision-journal.md#decision-build-an-expense-tracker-at-all))

## The obvious thing nobody built

Think about what happens when you spend money around other people. You come back from lunch and your partner asks what you had. "Grabbed ramen, it was like twelve bucks." You split a cab and text your friend: "Uber was $23, send me half." You're already telling people what you spent, in plain language, without thinking about it.

So why not tell a bot?

What if logging an expense was literally as easy as sending a text message? No app to open. No form to fill out. No category to pick. Just... tell it. "Coffee 4.50" or "Grabbed lunch with the team, $45" or "Uber to the airport was $23." Done. Tracked.

That was the whole insight. Not a better expense tracker. A fundamentally different interaction model. One that meets you where you already are — in a chat window — doing something you already know how to do — sending a message. ([read more](../decision-journal.md#decision-build-it-as-a-telegram-bot))

## Three ways in, zero excuses

Gastos lives in Telegram. You open a chat with it like you would with any contact. And then you just talk to it.

**Type it.** The most natural way. "Groceries $87" works. So does "spent 15 on lunch and 4.50 on coffee." You can log one thing or five things in the same message. Gastos is smart enough to pull out each expense separately — amounts, descriptions, all of it. No special formatting required. Just talk like a human.

**Snap it.** Got a receipt? Take a photo and send it. Gastos reads the image, extracts what you bought and how much it cost, and logs everything. This is the end-of-day move — dump all your receipts in one go. Five photos, ten receipts, doesn't matter. Each one gets processed and logged individually.

**Say it.** Hate typing? Record a voice message. "I spent twenty bucks on gas and picked up groceries for sixty-two fifty." Gastos transcribes it, understands it, and logs both expenses. ([read more](../decision-journal.md#decision-support-photo-and-voice-input-multimodal))

The point isn't that any one of these is revolutionary. It's that together, they remove every excuse for not logging an expense. Sitting at your desk? Type it. Walking out of a store with a receipt? Snap it. Driving? Voice message it. There is no scenario where "it was too hard to log" is a valid excuse anymore.

You can log as things happen throughout the day, or batch everything in one session before bed. Both work. Gastos doesn't care about your workflow. It just cares that expenses get tracked.

## Ask it anything

Here's where it gets interesting. Gastos doesn't just record what you tell it — it actually understands what you're spending on.

Ask it "how much did I spend on drinks this month?" and it won't just search for the word "drinks." It'll pull up your Starbucks runs, the Gatorade you grabbed at the gas station, the smoothie from that place you can never remember the name of. It understands that all of those things are drinks, even though none of them literally say "drinks" in the description. ([read more](../decision-journal.md#decision-semantic-search-via-vectorize))

You can have a real conversation with it, too. Ask a question, then follow up. "What did I spend on food last week?" Then: "Break that down by day." Then: "Which day was the most expensive?" It remembers what you were talking about and keeps the thread going, like talking to a person who happens to have perfect memory of your finances.

For the quick checks — the ones where you just want a number — there are simple commands. Today's total. This week's total. This month's total. One tap, instant answer. No charts to load, no dashboards to navigate. Just the number you were looking for.

## When you need the full picture

Chat is perfect for logging and quick questions. But sometimes you want to sit down and really look at your spending. Scroll through a list of expenses. Edit the one where the receipt scan got the amount wrong. See a chart of where your money went this month.

That's what the Mini App is for. It opens right inside Telegram — no separate app to download, no website to visit, no new account to create. Just tap the button and you're looking at a proper dashboard.

You can browse your expenses, edit anything that needs fixing, review items where Gastos wasn't quite sure about the extraction, and see your spending patterns laid out visually. It's the full picture, available when you want it, invisible when you don't. ([read more](../decision-journal.md#decision-telegram-mini-app-for-analytics-instead-of-bot-only))

## What this is really about

Gastos isn't trying to be your financial advisor. It won't tell you to stop buying coffee. It won't auto-categorize things into seventeen budget buckets. It won't connect to your bank account and pull transactions automatically.

It does one thing: make it dead simple to track what you spend. Because the biggest problem with expense tracking was never the tracking part — it was the part where you actually had to do it. Make that part effortless, and the rest takes care of itself.

You already have Telegram on your phone. You already know how to send a message. That's all the onboarding you need.
