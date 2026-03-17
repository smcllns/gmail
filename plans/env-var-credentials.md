# PR: Env var support for OAuth credentials

Implements https://github.com/smcllns/gmail/issues/21

## Motivation

The proxy currently reads tokens from files, then deletes them. This works but is fragile (race conditions, file permission issues — we hit EACCES during sprite testing). With env var support, the entire credential flow is in-memory: env vars → GmailService → Gmail API. No files touched.

This also makes sprite setup simpler: `sprite exec -env "GMAIL_REFRESH_TOKEN=xxx" gmail search "in:inbox"` just works.

## Env vars

| Var | Required | Description |
|-----|----------|-------------|
| `GMAIL_CLIENT_ID` | Yes (with refresh token) | OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Yes (with refresh token) | OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | Yes | OAuth refresh token |
| `GMAIL_ACCOUNT` | No | Email address (default: derived from token or first configured account) |

When all three required vars are set, the CLI skips file-based config entirely. No `~/.gmail-cli/` needed.

## Changes

### 1. `src/cli.ts` — env var account bootstrap

Early in CLI startup (before command dispatch), check for env vars:

```typescript
if (process.env.GMAIL_REFRESH_TOKEN) {
  const email = process.env.GMAIL_ACCOUNT || opts.account;
  if (!email) {
    // Could derive from token via /userinfo endpoint, but simpler to require it
    console.error("GMAIL_ACCOUNT or --account required when using env var credentials");
    process.exit(1);
  }
  gmail.setAccountTokens({
    email,
    oauth2: {
      clientId: process.env.GMAIL_CLIENT_ID!,
      clientSecret: process.env.GMAIL_CLIENT_SECRET!,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
    },
    scopes: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.labels"],
  });
}
```

### 2. `src/gmail-service.ts` — skip `ensureAnyScope` when proxied

When `GMAIL_PROXY` is set, skip `ensureAnyScope` (the proxy enforces scope, not the CLI). This fixes the issue both Pi and Gemini flagged in PR #22.

```typescript
private ensureAnyScope(email: string, required: string[], action: string): void {
  if (process.env.GMAIL_PROXY) return; // proxy enforces scope
  // ... existing logic
}
```

### 3. `src/gmail-service.ts` — skip `getAccount` for proxy mode

When `GMAIL_PROXY` is set and no account exists locally, don't throw. The proxy handles auth.

### 4. README.md — document env vars

Add env var section with examples for sprite and local use.

## How the proxy benefits

With this change, `sprite-start.sh` simplifies from:

```bash
# Before: write file, chown, proxy reads & deletes
echo "$TOKEN" > /tmp/oauth-token
chown proxy:proxy /tmp/oauth-token
su proxy -c "bun run proxy --token-file /tmp/oauth-token ..."
```

To:

```bash
# After: pure env var, zero files
GMAIL_REFRESH_TOKEN=$TOKEN GMAIL_CLIENT_ID=$ID GMAIL_CLIENT_SECRET=$SECRET \
  su proxy -c "bun run proxy ..."
```

And the proxy itself can use `GmailService` directly instead of raw fetch + token management:

```typescript
// Proxy can bootstrap from env vars like any other consumer
const gmail = new GmailService();
// env vars already loaded by CLI bootstrap
```

## Testing

- [ ] `GMAIL_REFRESH_TOKEN=xxx GMAIL_ACCOUNT=test@gmail.com gmail search "in:inbox"` works
- [ ] Without env vars, existing file-based flow still works
- [ ] `GMAIL_PROXY` + env vars work together (proxy mode, no local account needed)
- [ ] Missing required env vars give clear error messages
- [ ] `--account` flag overrides `GMAIL_ACCOUNT` env var
