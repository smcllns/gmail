Test ROI Audit (Proposed Removals Only)

Purpose
This document lists low-ROI tests that could be removed or consolidated to keep the suite efficient. It does NOT remove any tests. Use this as a review aid before pruning.

Categories
1) Zero value / tautological
2) Real risk, but rare
3) Real risk, but overhead > value
4) Other: redundant/brittle/low-fidelity (prefer consolidation)

1) Zero value / tautological
- src/gmail-service.test.ts: "constructor without arguments still works" — validates default constructor exists, but does not check behavior.
- src/mock-gmail-service.test.ts: "setAccountTokens is a callable method for API parity" — only checks method presence.
- src/mock-gmail-service.test.ts: "accepts an EmailAccount and is a no-op" — no behavior asserted beyond no error.

2) Real risk, but rare
- src/gmail-service.test.ts: "configDir resolves relative paths to absolute" — relies on Node path semantics; regressions unlikely.
- src/gmail-service.test.ts: "configDir threads through to AccountStorage on lazy init" — internal detail test, rare failure mode.
- src/mock-gmail-service.test.ts: "setThreads convenience method" — helper is seldom used; minimal product risk.
- src/mock-gmail-service.test.ts: "listLabels returns empty array by default" — default state sanity, but low likelihood of regression.

3) Real risk, but overhead > value
- src/mock-gmail-service.test.ts: call tracking timestamps — internal bookkeeping rather than product behavior.
- src/mock-gmail-service.test.ts: call tracking multiple calls — similar internal detail; can keep one representative test at most.
- src/mock-gmail-service.test.ts: repeated "records call parameters" tests across methods — keep a single exemplar to verify tracking works.

4) Other: redundant/brittle/low-fidelity (prefer consolidation)
- src/gmail-service.test.ts: GMAIL_LABEL_COLORS membership — brittle to palette updates; not a behavioral guarantee.
- src/gmail-service.test.ts: decodeHtmlEntities cases — too many equivalent cases; keep 1-2 canonical examples.
- src/gmail-service.test.ts: stripHtml cases — similarly over-granular; keep 1-2 representative examples.
- src/gmail-service.test.ts: normalizeNulls cases — multiple overlapping assertions; keep one nested object and one array case.
- src/gmail-service.test.ts: setAccountTokens cache clearing test — doesn’t verify cache invalidation; low-fidelity signal.

Notes
- If pruning, keep at least one test per behavior cluster to preserve signal.
- Prefer removing internal bookkeeping tests before behavior-focused tests.
