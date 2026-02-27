# Gastos Mini App Dashboard - Product Requirements Document 

## Objective
The Gastos Telegram Bot excels at rapid, frictionless expense logging via text, voice, and photos. However, the chat interface is fundamentally limited when it comes to reviewing historical data, editing mistakes, and viewing aggregate charts.

The objective of the **Gastos Mini App** is to solve this by embedding a React-based web dashboard directly inside Telegram as a native overlay. This allows users to seamlessly switch from "fast logging" (chat) to "detailed management" (GUI) without ever leaving the Telegram app.

---

## 1. Core User Flows

### A. The Dashboard Overview
When a user launches the Mini App from the bot menu, they should land on a summary dashboard containing:
* **Time-period Tabs**: Today, This Week, This Month, This Year.
* **Top-level Metrics**: Total spend, transaction count, most common currency.
* **Visualizations**: A simple bar or line chart showing spend velocity over the selected period.

### B. Transaction Review & Editing
The AI extraction process is asynchronous and sometimes imperfect (e.g., misinterpreting an amount or categorizing an expense poorly).
* **Review Queue**: A dedicated section highlighting transactions marked as `needs_review` (uncertain AI confidence).
* **Edit Flow**: Users can tap any transaction in their history, opening a modal to mutate the `amount_minor`, `currency`, or add a custom `category` (which we will introduce to the schema).
* **Deletion**: Users can delete duplicate or accidental logs.

---

## 2. Technical Architecture

### A. Frontend Stack
* **Framework**: Next.js (App Router) or Vite + React. 
* **UI Library**: Tailwind CSS + Shadcn/UI for rapid, accessible, mobile-first component development.
* **Telegram SDK**: `@twa-dev/sdk` (Telegram Web App SDK) to handle authentication, haptics, theme synchronizations (dark/light mode adapting to the user's Telegram client), and closing the app.

### B. Backend API Integration (REST)
The Mini App requires a new RESTful interface exposed by our existing Cloudflare Worker. We will add a router (e.g., Hono) to our Worker to serve these endpoints:
* `GET /api/users/me` (Profile and preferences)
* `GET /api/expenses?period=thisweek` (List of expenses with pagination)
* `GET /api/expenses/review` (List of expenses flagged by the AI for review)
* `PUT /api/expenses/:id` (Update amount/currency)
* `DELETE /api/expenses/:id` (Delete expense)

### C. Authentication Flow
We must trust that the user accessing the web app is who they claim to be without requiring a password.
1. The user taps the "Open App" inline button in Telegram.
2. Telegram opens the Web App URL and passes `window.Telegram.WebApp.initData`.
3. The frontend sends `initData` to the Cloudflare Worker API in the `Authorization` header.
4. The backend validates the HMAC signature of `initData` using our `TELEGRAM_BOT_TOKEN`.
5. If valid, the backend trusts the `user_id` inside `initData` and returns the data.

---

## 3. Deployment Strategy
* **Backend**: Cloudflare Workers (existing `gastos-telegram-bot` worker).
* **Frontend Hosting**: Cloudflare Pages. Both projects will be contained in a monorepo or adjacent directories.
* **Domain**: A secure `https://` domain is strictly required by Telegram for Mini Apps (provided automatically by Cloudflare Pages).
* **Bot Configuration**: We will register the deployed Cloudflare Pages URL using `@BotFather` as the native Menu Button.

---

## 4. Phase 1 Implementation Plan
1. **API Expansion**: Add Hono routing to the Cloudflare worker and build the GET and PUT expenses endpoints, including Telegram `initData` HMAC validation.
2. **Scaffold Frontend**: Initialize a Next.js/Vite project tailored for mobile screens (100vh, fixed bottom navigation).
3. **Core Screens**: Build the Dashboard (Read-only) and the Review Queue (Read/Write).
4. **Integration**: Link the bot menu to the deployed frontend.
