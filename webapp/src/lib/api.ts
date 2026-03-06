import WebApp from '@twa-dev/sdk';

// Determine base URL based on environment
// In production (Cloudflare Pages), the API is hosted tightly coupled or via absolute domain.
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8787/api";

type ExpenseWithDetails = {
    id: number;
    amount_minor: number;
    currency: string;
    occurred_at_utc: string;
    status: "final" | "needs_review";
    text_raw: string | null;
    r2_object_key: string | null;
    needs_review_reason: boolean;
    parsed_description: string | null;
    category: string;
    tags: string;
};

// Helper to get authentication header
function getAuthHeaders() {
    // If we're inside Telegram, WebApp.initData contains the payload
    // If we're testing locally outside of TG, we might fall back to a mock string (empty string causes 401)
    const initData = WebApp.initData || import.meta.env.VITE_MOCK_INIT_DATA || "";

    return {
        "Authorization": `Telegram ${initData}`,
        "Content-Type": "application/json"
    };
}

export async function fetchUserProfile() {
    const res = await fetch(`${API_BASE_URL}/users/me`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function fetchExpenses(period: "today" | "thisweek" | "thismonth" | "thisyear"): Promise<ExpenseWithDetails[]> {
    const res = await fetch(`${API_BASE_URL}/expenses?period=${period}`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.data;
}

export async function updateExpense(id: number, amount_minor: number, currency: string, category?: string) {
    const res = await fetch(`${API_BASE_URL}/expenses/${id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ amount_minor, currency, category })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

export async function deleteExpense(id: number) {
    const res = await fetch(`${API_BASE_URL}/expenses/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}
