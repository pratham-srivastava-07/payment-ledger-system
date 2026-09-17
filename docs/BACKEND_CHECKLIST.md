# Payment Ledger: review and backend completion checklist

Review date: 2026-09-17. Scope: the code in this checkout, not the proposed feature inventory.

This is an implementation guide for the project owner. No application behavior was changed during this review. Unchecked items are unfinished or lack the evidence required to call them complete. Complete each item with a code reference and a reproducible verification result, not just a feature name.

## 1. Current implementation and conventions

| Convention or concept | Repository evidence | Current limitation |
| --- | --- | --- |
| Express routes -> controllers -> services | `src/routes/index.ts`, controllers, services | Controllers receive services, but services construct their own DB, adapters, and event dependencies; failure injection is difficult. |
| Adapter and factory patterns | `src/adapters`, `src/factories/paymentAdapterFactory.ts` | Three simulated providers; `Promise<any>` contracts, random IDs, always-success responses and fixed balances. No persistent processor attempts. |
| Singleton resources | `src/singletons/db.ts`, `eventBus.ts` | Shared Prisma client and process-local EventEmitter; the latter has no durability or delivery guarantees. |
| Observer/event-driven dispatch | `PaymentHandler` listens for payment/refund events | Async ledger handling is outside payment completion and failures are logged and swallowed. |
| Double-entry posting | `LedgerService.recordTransaction` | Application-level floating-point balance check with a tolerance; not a DB-enforced invariant. |
| Atomic journal insert | Prisma transaction with nested ledger-entry creation | Only the journal and its entries share a transaction; payment completion does not. |
| Derived account balances | Ledger aggregation | Decimal values are converted to JS numbers; sign conventions differ between ledger API and reconciliation. |
| Reversal-style refunds | `PaymentHandler.handleRefundReceived` | Creates opposite entries, but does not link/validate the original transaction or track partial refunds. |
| Idempotency foundations | Unique DB keys, request hash, response replay middleware | Two competing identities (header key and body paymentId), global scope, race/error/recovery gaps. |
| Relational integrity | PKs, FKs, unique external references, entry lookup indexes | No balance, amount, currency-match or append-only enforcement. No unique system-account identity. |
| TypeScript and formatting | Strict TS, ESLint, Prettier | Explicit `any`, casts, `ts-ignore`, inconsistent file naming, and unused custom error classes weaken the conventions. |
| API documentation | Swagger annotations | Bearer auth differs from middleware behavior; schemas omit Razorpay and idempotency header requirements. |
| Operational scaffolding | Compose, Dockerfile, migrations, GitHub Actions | No automatic migration deployment or substantive test gate; CI masks test failure. |

Preserve the monolith and domain-oriented services. Introduce dependency injection at the DB, clock, processor and publisher boundaries when needed for deterministic tests. No generic repository layer or microservice split is required.

### Claims not supported by this checkout

There is no integer-minor-unit implementation, enforced immutable ledger, explicit payment/refund state machine, Redis layer, processor-attempt model, atomic payment-plus-ledger completion, isolation experiment, pessimistic locking, serializable retry, concurrency suite, projection/rebuild worker, transaction-level bank reconciliation, transactional outbox, durable consumer, webhook delivery, DLQ, property testing, benchmark suite, or telemetry stack.

The README's “production-grade” and “immutable ... strict balancing” descriptions exceed the available implementation and evidence. Decimal storage itself is exact; the current arithmetic before and after storage is not.

## 2. Prioritized review findings

These are static code findings; they have not been reproduced against a running database.

| Priority | Finding and evidence | Consequence / required regression |
| --- | --- | --- |
| Critical | `PaymentService.service.ts:54` emits to an async handler, then independently marks the event processed at line 63. `paymentHandler.ts` catches ledger errors. | A successful response/processed event can exist without a journal. Force ledger failure and require atomic local completion or explicit recoverable pending state. |
| Critical | `PaymentService.service.ts:74` refunds without checking an original payment, amount remaining, provider, currency or refund identity. Handler uses `REFUND_<paymentId>` for every refund. | Repeated calls with different header keys can refund externally multiple times while only one refund journal fits the unique reference. Test nonexistent payments, partial refunds, duplicates and concurrent over-refunds. |
| High | `LedgerService.service.ts:15` sums JS numbers and accepts a tolerance. Schema/migrations lack financial check constraints and mutation guards. | Empty postings, negative entries, entries with both sides populated and currency mismatches are not rejected by the service's balancing rule. Direct SQL can mutate history or bypass balancing. |
| High | `middlewares/idempotency.ts:19` reads before inserting; lines 54-65 persist responses in the background. `lockedAt` has no recovery semantics. | Concurrent claims can become generic errors; a crash after work but before response persistence can leave permanent 409s. Test claim races, crash recovery and response loss. |
| High | Idempotency lookup checks only key and raw JSON hash, never stored requestPath or authenticated identity. `PaymentService.service.ts:24` treats any existing event as processed. | Cross-operation/user key collisions can replay an unrelated result. A failed/incomplete charge can be reported as already processed; a reused body paymentId can silently ignore a changed payload. |
| High | Processor result `success` is never inspected; adapters accept no stable processor idempotency key and no lookup/recovery contract. | Adding realistic rejection/timeout behavior would create false success or an unresolved external charge. Test decline separately from unknown outcome after timeout. |
| High | Controllers use truthiness checks; provider casting is not runtime validation. | Negative numbers and malformed values can reach side effects. Validate positive supported-range amounts, currency, provider and identity before claiming work or charging. |
| High | `routes/index.ts:33` leaves reconciliation trigger unauthenticated; ledger reads have no ownership check. `auth.ts:10` verifies the entire header instead of parsing Bearer. | Documented auth fails for standard Bearer clients; authenticated callers are not scoped to accounts. Define admin-only versus tenant scope, then test access boundaries. |
| High | `LedgerService.service.ts:73` uses find-then-create without a natural-key unique constraint. | Concurrent first payments can create duplicate system accounts and split reconciliation totals. Test synchronized first-use creation. |
| Medium | Ledger balance uses credit-minus-debit universally; reconciliation uses debit-minus-credit for providers and implicitly USD. External balances are constants. | API and reconciliation disagree on asset signs, and reports cannot identify missing/duplicate settlements or support non-USD reconciliation correctly. |
| Medium | `.github/workflows/ci.yml` uses `npm test || echo ...`; package test script always fails. | Green CI supplies no behavioral evidence. No tests or DB migration step are present. |

The current posting credits the entire payment to platform revenue. The proposed merchant-payable/fee split is a different accounting model and must be explicitly designed before implementing it.

## 3. Ordered implementation checklist

### Milestone 0 — Scope decisions and executable baseline

- [ ] Decide whether this is a single-operator demo or a tenant-aware service; define account ownership and authorization accordingly.
- [ ] Write the accounting example for payment, partial refund and full refund: actual account classes, debit/credit normal balances, fee policy and currencies. Do not silently assume every payment is platform revenue.
- [ ] Define money representation and wire format: integer minor units, supported currency exponents, range/overflow policy, and JSON serialization if using bigint.
- [ ] Decide the relationship among payment ID, HTTP idempotency key, refund ID, processor operation key and event ID. Specify replay, conflict and pending responses.
- [ ] Establish isolated disposable PostgreSQL test storage; never run cleanup against a development or shared database.
- [ ] Add test commands for unit, integration, concurrency and E2E suites; ensure test sources are type-checked separately from the production build.
- [ ] Install from the lockfile, generate Prisma, check formatting/lint/types and record the baseline. Fix CI to fail on test failures and deploy migrations into its disposable DB.
- [ ] Correct README claims and setup instructions once the verified baseline is available.

Exit: a fresh checkout can migrate a disposable DB and execute at least one meaningful rollback test in CI.

### Milestone 1 — Financial model and journal invariants

- [ ] Model payment, processor attempt, refund, journal and journal-entry identities and relationships. Separate payment lifecycle from immutable posted financial history.
- [ ] Make system-account identity unique within its intended scope, including currency; handle concurrent creation.
- [ ] Implement exact minor-unit arithmetic throughout requests, processor contracts, persistence, aggregates and responses.
- [ ] Reject empty journals, invalid amounts, negative sides, both-sided/zero entries, currency mismatches and unbalanced totals. Define whether journal amount equals total debits for the supported posting model.
- [ ] Enforce row-local rules with DB constraints. Design a commit-time cross-entry balance check or controlled posting boundary; an ordinary row CHECK cannot sum sibling rows.
- [ ] Enforce append-only posted history through DB permissions/guards, including transaction metadata that affects financial meaning. Test using the application DB role.
- [ ] Give each payment/refund operation at most one journal via durable relational/unique constraints; link reversals to original postings.
- [ ] Derive balances with an explicit normal-balance convention and consistent currency. Make entries-plus-balance responses use a coherent read snapshot where required.
- [ ] Plan data migration explicitly if existing financial rows must be preserved; do not rewrite applied migrations or silently reset data.

Exit: direct SQL and service-level tests prove rejection of invalid postings; valid posting commits all entries, injected failure commits none, and reversal leaves original history unchanged.

### Milestone 2 — Payment lifecycle and durable idempotency

- [ ] Define permitted payment/attempt transitions, including declined and unknown processor outcomes. Guard transitions in the database operation, not only an earlier read.
- [ ] Introduce typed deterministic mock results: success, decline, transient error, timeout before execution, timeout after successful execution and lookup of prior result.
- [ ] Claim scoped HTTP operations atomically with PostgreSQL uniqueness; compare normalized request fingerprints and handle unique-conflict races deliberately.
- [ ] Persist result/replay semantics durably with the business operation where possible; define recovery for interrupted claims. A timestamp expiring must not itself authorize a second charge.
- [ ] Persist a processor attempt before calling the provider; send a stable provider idempotency key and retain provider references/outcomes.
- [ ] Keep network calls outside long-lived DB transactions. Recover unknown outcomes by lookup or replay using the same provider key.
- [ ] Finalize successful payment state and its journal in one DB transaction. Make posting accept that transaction context.
- [ ] Add bounded retries only for classified transient transaction failures; never put an unprotected external charge inside a retried DB closure.
- [ ] Test lost HTTP response after successful commit, simultaneous same-key requests, different-key/same-payment requests, changed payload, worker restart and conflicting callbacks.

Exit: one logical payment has one external charge and one journal under retry; unknown outcomes remain visibly recoverable instead of being declared failed or successful without evidence.

### Milestone 3 — Refund lifecycle and contention correctness

- [ ] Validate original successful payment, provider, currency, refund policy and positive amount before issuing refunds.
- [ ] Allocate a distinct idempotent refund identity for each partial refund and link its reversal journal to the original payment.
- [ ] Reserve refundable capacity atomically; successful plus active reserved refunds must not exceed captured amount. Keep unknown external outcomes reserved until resolved.
- [ ] Choose row locking or conditional atomic updates for refund reservation; define deterministic lock ordering where multiple rows are involved.
- [ ] Atomically finalize refund state, reserved/consumed capacity and reversal journal; release capacity only on a definitive failure.
- [ ] Use barriers to race two refunds that each fit independently but exceed remaining capacity together. Assert external calls and all persisted rows, not only HTTP responses.
- [ ] Build separate educational isolation experiments for lost updates and write skew. Specify transaction schedules and invariants for READ COMMITTED, REPEATABLE READ and SERIALIZABLE.
- [ ] Implement bounded serializable retry tests and compare strategies on the same workload and financial invariant.

Exit: concurrent partial refunds cannot exceed captured funds, cannot post twice, and never alter the original journal.

### Milestone 4 — Outbox, consumer deduplication and webhooks

- [ ] Insert a versioned outbox event in the same transaction as successful payment/refund completion and journal posting.
- [ ] Implement bounded publisher batches, concurrent-worker claims, crash-recoverable leases, retry/backoff with jitter and observable pending/failed state.
- [ ] Choose and document a durable broker/delivery mechanism; define ACK, redelivery and retention behavior before integrating it. Redis is optional and is not the correctness authority.
- [ ] Mark publication only after broker confirmation; preserve stable event IDs across retries. Prove the publish-before-mark crash produces safe duplicate delivery.
- [ ] Add consumer deduplication unique on `(consumer, eventId)`; commit the dedup record and local business effect in one DB transaction, then ACK.
- [ ] For remote effects, create a durable delivery job first. A processed-events row alone cannot atomically protect an external HTTP side effect.
- [ ] Implement webhook delivery records, stable delivery IDs, attempt history, timeouts, bounded exponential backoff/jitter, terminal failures and audited replay.
- [ ] Define webhook signing and endpoint policy appropriate to scope; retry to a controlled mock receiver in tests.
- [ ] Test consumer crash before commit, after commit/before ACK, parallel duplicate delivery, publisher crash, exhausted delivery, DLQ and replay.

Exit: committed financial changes always leave durable notification intent; redelivery cannot duplicate consumer DB effects. Webhook recipients receive stable identities for their own deduplication.

### Milestone 5 — Reconciliation and projections

- [ ] Generate reproducible mock external transaction statements with provider references, amounts, currencies, status and settlement windows.
- [ ] Detect missing internal/external items, duplicates, amount/currency/status differences and explain timing differences; persist run and mismatch identities.
- [ ] Define investigation and correction workflow. Never silently modify ledger history to make a report match.
- [ ] Add a rebuildable balance projection only after ledger-derived balances are correct; define deduplication and checkpoint behavior.
- [ ] Detect projection drift and rebuild into a separate version using a consistent snapshot/checkpoint plus catch-up; verify before cutover under concurrent writes.
- [ ] Test repeated reconciliation runs, partial statement ingestion, deliberate projection corruption, rebuild interruption and successful convergence.

Exit: a mismatch identifies concrete operations and a recovery action; projected balances can be reproduced exactly from journal history.

### Milestone 6 — Failure-oriented and generative evidence

- [ ] Implement deterministic failpoints restricted to the test harness; distinguish exceptions from actual process termination/restart.
- [ ] Execute every row in the failure matrix below and retain expected state, observed state, recovery command/action and test reference.
- [ ] Generate seeded PAY/REFUND/RETRY/DUPLICATE/FAILURE/CALLBACK command sequences against a small independent reference model.
- [ ] Assert per-journal/per-currency debit-credit equality, refund limits, operation uniqueness, successful-payment/journal correspondence and unchanged historical rows after every committed operation.
- [ ] Separate safety (no invalid financial state) from liveness (pending work eventually recovers after dependencies return). Unknown processor outcomes may legitimately remain pending before recovery.
- [ ] Persist failing seeds and shrunk sequences. Combine sequential property testing with scheduled concurrent integration tests; one does not substitute for the other.

### Milestone 7 — Observability before load measurement

- [ ] Add structured logs and consistent errors with request, payment, attempt, journal, refund, event and delivery IDs; redact tokens and sensitive payloads.
- [ ] Trace HTTP, idempotency, orchestration, processor, DB finalization, outbox publication, consumption and webhook attempts; propagate trace context across async boundaries.
- [ ] Measure payment outcomes, idempotency hits/conflicts, posting and DB transaction duration, outbox count/oldest age/publish failures, webhook failures/retries and reconciliation mismatches.
- [ ] Measure DB lock waits, connection-pool utilization/wait time and serialization/deadlock retry counts using actual DB/client instrumentation, not inference from HTTP latency.
- [ ] Keep metric labels bounded; put payment IDs in logs/traces rather than metric labels.
- [ ] Add readiness and graceful shutdown behavior for API/workers; document investigation of a stuck payment using its durable state and telemetry.
- [ ] Benchmark 10, 100, 500, 1,000, 5,000 and 10,000 concurrent operations progressively, subject to machine limits and stop thresholds.
- [ ] Separate independent-account, hot-account, duplicate-key and concurrent-refund workloads. Record offered load as well as achieved throughput; concurrency is not RPS.
- [ ] Record p50/p95/p99, RPS, error rate, retry rate, transaction time, lock waits, pool queues, CPU/I/O and correctness checks. Include warm-up, steady-state duration, hardware, pool size, dataset, commit and repeated runs.
- [ ] Identify the first saturation point and demonstrate its cause from traces/DB evidence. Do not claim unexecuted load levels as passed.

Exit: reproduce a failure or bottleneck, explain it from evidence, and demonstrate recovery without violating journal invariants.

## 4. Failure-injection matrix

Target behavior for the completed design, not claims about current code.

| Injection point | Expected durable state | Recovery / assertion |
| --- | --- | --- |
| Before payment insert | No payment, charge or journal; any separate request claim has a defined recovery path | Same operation can resume safely. |
| After payment insert, before processor | Pending operation/attempt, no successful journal | Worker/retry resumes the stable operation. |
| After processor success, before outcome persistence | Provider may have charged; local outcome unknown | Query/replay same provider key; never create a new charge identity. |
| Before ledger posting | Pending local finalization, provider outcome recoverable | Retry atomic finalization once. |
| During ledger insertion | Finalization transaction rolls back: no partial journal, success status or outbox event | Retry after resolving fault. |
| After finalization commit, before HTTP response | Success, complete journal and outbox all durable | Client replay returns canonical result without recharging. |
| Before event publish | Pending outbox remains durable | Publisher restarts and drains it. |
| After event publish, before marking published | Event may be delivered twice | Same event ID; consumer effect committed once. |
| After consumer commit, before ACK | Effect and dedup row both durable | Redelivery observes dedup row and ACKs safely. |
| During webhook delivery / lost response | Remote receiver may already have accepted delivery | Retry same delivery identity; receiver deduplicates. Exhaustion moves to visible terminal state. |

## 5. Verification strategy and evidence log

| Suite | What belongs here |
| --- | --- |
| Unit | Money bounds, state transitions, posting rules, request fingerprints and retry classification using deterministic clock/randomness. |
| PostgreSQL integration | Migrations, application-role permissions, constraints, atomic rollback, idempotent claims, journal linkage, outbox/dedup transactions and rebuild consistency. Do not substitute SQLite or mocked Prisma for these guarantees. |
| Concurrency | Barrier-controlled overlapping DB transactions, multiple workers/processes, claim races, refund reservations, deadlocks and serialization retries. Avoid relying on arbitrary sleeps to create overlap. |
| E2E | HTTP request through controlled processor, PostgreSQL, publisher/consumer and mock webhook receiver, including rejection and recovery. |
| Failure/property | Process restart tests and seeded model-based sequences, with final DB and external fake assertions. |
| Performance | Reproducible sustained workloads with telemetry and post-run invariant verification, separate from correctness tests. |

For each completed milestone record: code/migration references, exact command, environment, expected result, actual result, and remaining limitations.

Review baseline: all tracked source, schema/migrations, runtime configuration, Docker configuration and CI were inspected. No test files were found; local `node_modules` is absent. No database, processor recovery, HTTP or concurrency behavior has been dynamically verified.

| Command | Observed result |
| --- | --- |
| `npm test` | Failed as configured: placeholder prints “no test specified” and exits 1. |
| `npm run build` | Failed with missing dependency/type errors, including Prisma and Express. Dependencies are not installed, so this does not establish whether a properly installed checkout compiles. |
| `npm run lint` | Could not run: local ESLint executable unavailable. |
| `git diff --check` | Passed for tracked changes; the only new deliverable is this untracked checklist document. |

No dependencies were installed, migrations executed, or application source edited during this review.

## 6. Backend stopping rule and later demo

Backend completion requires evidence for financial invariants, duplicate/concurrent execution safety, partial-failure recovery, durable delivery, reconciliation, telemetry and a measured contention limit. A feature being present is insufficient.

After that, build the small operations console: bounded payment list, detail/timeline/journal view, real health/reconciliation summaries and deterministic scenario controls. Define the read API first. Keep scenario controls isolated to demo/test environments. Do not add microservices, Kubernetes, extra databases, checkout or new financial products to finish this scope.

First implementation slice: Milestone 0 decisions and test harness, followed by one valid journal test, one invalid journal test and one rollback test. Establish these before starting outbox or UI work.
