# Skill: PR Code Review

When executing a `/code-review`, analyze the current git diff and focus on:
1. Identifying potential memory leaks or unhandled promises in the Cloudflare Worker environment.
2. Verifying that the code adheres to our `.antigravityrules`, particularly around UTC timestamps and pure DB reads for totals.
3. Emitting a summary Artifact with a list of required changes.
