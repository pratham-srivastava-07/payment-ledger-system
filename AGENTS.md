# Repository working agreement

- Do not create or modify tests unless the user explicitly requests tests. A feature request does not authorize adding tests.
- Use build, type checking, linting and schema validation for routine verification. Ask before expanding verification into test work.
- Do not stage, commit, push or deploy unless explicitly requested.
- Keep payment/refund state, journal posting and outbox insertion in one caller-owned database transaction. Processor calls stay outside it.
- Money uses integer minor units internally and digit strings in JSON. Do not convert financial amounts to JavaScript numbers.
- Preserve append-only ledger history and stable processor/event identities across retries.
