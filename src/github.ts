type IssueParams = {
  title: string;
  body: string;
  labels: string[];
};

/**
 * Creates a GitHub Issue via REST API.
 * Returns the issue URL on success, null on failure.
 * Never throws — designed for fire-and-forget usage.
 */
export async function createGithubIssue(
  token: string,
  repo: string,
  params: IssueParams,
): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "gastos-telegram-bot",
      },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        labels: params.labels,
      }),
    });

    if (response.status !== 201) {
      const text = await response.text().catch(() => "(unreadable)");
      console.error(`[github] API failure: status=${response.status} body=${text}`);
      return null;
    }

    const data = (await response.json()) as { html_url: string };
    return data.html_url;
  } catch (err) {
    console.error("[github] Network error creating issue:", err);
    return null;
  }
}
