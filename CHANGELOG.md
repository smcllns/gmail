# Changelog

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
