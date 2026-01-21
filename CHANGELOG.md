# Changelog

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
