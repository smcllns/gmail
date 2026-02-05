Security Notes: Gmail CLI Hardening

Context
This library is used in an email assistant where read-only (dry-run) and live label changes are distinct modes. The goal is least privilege, explicit consent for write access, and safe handling of untrusted email content.

Design Principles
- Least privilege by default. Read-only auth should not inherit previously granted scopes.
- Fail closed on unknown scope state for any mutation.
- Treat all email content, labels, and IDs as untrusted input (terminal output and filenames).
- Protect secrets at rest with restrictive permissions and atomic writes.

Key Decisions and Rationale
1) OAuth scope handling
   - Read-only auth uses only gmail.readonly and does NOT include previously granted scopes.
   - Upgrade to live mode requires explicit consent to obtain gmail.modify.
   - Scopes are stored with the account and enforced for mutating operations.

2) OAuth flow hardening
   - PKCE + state are required to prevent code interception and CSRF.

3) CLI safety
   - Adding TRASH or SPAM labels is blocked unless explicitly overridden.
   - Terminal output is sanitized to strip control characters.
   - Thread IDs are encoded when forming Gmail URLs to avoid output injection.

4) Storage and filesystem safety
   - Config and attachment directories use restrictive permissions (0700).
   - Secret-bearing files (credentials, accounts, config) are written atomically with 0600.
   - Attachment filenames are sanitized to prevent path traversal/control characters.

Non-goals
- This CLI does not send or delete email. These operations are intentionally blocked in the CLI even if OAuth scopes could allow them.

If You Modify Security-Critical Code
- Keep default auth least-privilege; do not re-enable include_granted_scopes by default.
- Preserve PKCE + state checks in OAuth.
- Maintain scope checks for any label or settings mutation.
- Keep terminal/file sanitization for untrusted content.
- Preserve restricted permissions and atomic writes for secrets.

Suggested Quick Review Checklist
- Does this change add new OAuth scopes or relax scope enforcement?
- Can untrusted content reach the terminal or filesystem without sanitization?
- Are secrets written with 0600 and directories with 0700?
- Does any mutation path run without verifying scopes?
