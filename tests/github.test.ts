import { describe, it, expect, vi, afterEach } from "vitest";
import { createGithubIssue } from "../src/github";

const TOKEN = "ghp_test_token";
const REPO = "testowner/testrepo";
const PARAMS = {
  title: "Bug: something broke",
  body: "Steps to reproduce...",
  labels: ["bug", "feedback"],
};

describe("createGithubIssue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an issue and returns the html_url on success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ html_url: "https://github.com/testowner/testrepo/issues/42" }),
        { status: 201 }
      )
    );

    const result = await createGithubIssue(TOKEN, REPO, PARAMS);

    expect(result).toBe("https://github.com/testowner/testrepo/issues/42");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/testowner/testrepo/issues");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer ghp_test_token");
    expect((init.headers as Record<string, string>)["Accept"]).toBe("application/vnd.github+json");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("gastos-telegram-bot");
    expect(JSON.parse(init.body as string)).toEqual({
      title: PARAMS.title,
      body: PARAMS.body,
      labels: PARAMS.labels,
    });

    fetchMock.mockRestore();
  });

  it("returns null on API failure (non-201 status)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })
    );

    const result = await createGithubIssue(TOKEN, REPO, PARAMS);

    expect(result).toBeNull();

    fetchMock.mockRestore();
  });

  it("returns null on network error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network failure")
    );

    const result = await createGithubIssue(TOKEN, REPO, PARAMS);

    expect(result).toBeNull();

    fetchMock.mockRestore();
  });
});
