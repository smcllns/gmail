# Changelog

## 0.9.1

### Added

- Environment variable credentials (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_ACCOUNT`) — run without file-based config
- Partial env var detection with helpful error when setup is incomplete
- `--account=` syntax support (in addition to `--account <email>`)

### Changed

- `ensureAnyScope` skips client-side scope checks when `GMAIL_PROXY` is set (proxy enforces scope)
- Removed all unintentional `any` types across codebase (only 2 intentional remain with comments)
- `MessagePayload` type now includes `attachmentId` in body

### Fixed

- Silent wrong account resolution when `--account` flag absent but env var credentials set
- Missing `break` in `send`/`delete` switch cases (worked by accident via `throw`)

## 0.8.0

### Added

- Read-only account auth plus upgrade flow for live label changes
- Scope tracking on accounts and `updateGmailAccount()` for re-auth
- Dangerous label guard with `--allow-dangerous-labels` override
- Attachment filename sanitization

### Changed

- Account storage uses atomic writes with stricter parsing

### ⚠️ Behavior Changes

- CLI blocks adding TRASH/SPAM labels unless explicitly allowed
- Corrupted `accounts.json` now throws instead of silently ignoring
- Label create/update requires `gmail.labels` when scopes are recorded

## 0.6.0

### Added

- `setAccountTokens()` method on `GmailService` for providing OAuth tokens programmatically
- Constructor `accounts` option for declaring accounts at initialization
- `GmailServiceOptions` and `EmailAccount` types exported from main package
- `setAccountTokens()` on `MockGmailService` for API parity

### Changed

- `AccountStorage` is now lazy — no filesystem access (`~/.gmail-cli/`) when only using in-memory accounts

## 0.5.0

### ⚠️ Breaking Changes

- `getThread()` now returns `undefined` instead of `null` for absent values. Code checking `=== null` will need to check `=== undefined` instead.

### Added

- `MockGmailService` for testing - import from `@smcllns/gmail/testing`
- `normalizeNulls()` utility exported from main package

## 0.4.0

- Add parsed message content to `getThread()` response

## 0.3.2

- Initial public release
