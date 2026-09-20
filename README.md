# Payment Ledger

A TypeScript/Express and PostgreSQL payment-ledger learning project. The current backend implements durable mock payments and refunds, exact integer money, balanced append-only journals, and a transactional outbox with a PostgreSQL inbox destination. Stripe, PayPal and Razorpay adapters are simulations, not real integrations.

## Run locally

Use Node.js 22 and PostgreSQL 15. Copy `.env.example` to `.env` and set the database URL and a private `JWT_SECRET`.

```sh
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run build
npm start
```

In another terminal, start the Next.js Payment Operations Console:

```sh
npm run dev:web
```

Open `http://localhost:3001`. The console starts in a clearly labeled sample workspace. Select **Connect API** to use the backend: paste the short-lived operator token generated below. The Next.js server proxies `/api` to `http://127.0.0.1:3000`; set `API_ORIGIN` in the web server environment if the API listens elsewhere. Live credentials stay in the current browser tab's session storage.

Build both applications with `npm run build:all`. For a standalone web production build, use `npm run build:web`; run it with `npm --prefix web run start`.

In another terminal, run the recovery and event-delivery worker:

```sh
npm run worker
```

`npm run worker:once` performs one bounded recovery/publication/consumption cycle. The API alone does not drain the outbox or automatically recover abandoned operations.

For a fresh Docker setup, set `JWT_SECRET` in `.env`, then run:

```sh
docker compose up --build
```

Compose runs migrations before starting the API and worker. Its application connections use the `db` service hostname. Database credentials in Compose are for local development. Review the migration notes below before connecting an existing database volume.

## API contract

Interactive documentation is available at `/api-docs` in both local and compiled-image runs.

Protected endpoints require `Authorization: Bearer <token>`. Tokens must be HS256-signed with `JWT_SECRET` and contain a nonempty `sub`. This is a trusted-operator demo: payment/refund requests and reads are scoped by subject, while ledger, reconciliation, activity and outbox diagnostics are system-wide. There is no tenant-administration or token-issuance service.

To create a short-lived token for your local demo:

```sh
node -r dotenv/config -e "console.log(require('jsonwebtoken').sign({sub:'local-operator'}, process.env.JWT_SECRET, {expiresIn:'1h'}))"
```

Payment/refund POST requests also require `x-idempotency-key`. The key is scoped to the token subject and operation type. Repeating a key with equivalent normalized request fields resumes or returns the existing operation; changing those fields returns 409. An optional caller-supplied payment ID is distinct from the key. Reusing that ID under another key also returns 409.

Money is now explicit integer **minor units**. Send `amountMinor` as a positive digit string (preferred) or safe integer JSON number; output amounts are strings. The maximum operation amount is signed int64. Supported currencies are USD, INR, EUR and GBP (2 decimal places), JPY (0), and KWD (3). The old `amount` request field is rejected rather than silently changing its meaning.

Create a payment using `POST /api/v1/payments`:

```json
{
  "paymentId": "demo-payment-1",
  "amountMinor": "10000",
  "currency": "USD",
  "provider": "STRIPE"
}
```

Refund part of it using `POST /api/v1/refunds` and a new key:

```json
{
  "paymentId": "demo-payment-1",
  "amountMinor": "2500"
}
```

Refund currency/provider come from the original payment. An optional refund `provider` must match. Each partial refund gets its own refund ID and reversal journal. Pending, processing, unknown and succeeded refunds reserve captured capacity; a definitive failure releases it.

Responses use 200 for success, 202 for processing/unknown outcomes, and 422 for definitive processor decline. A 202 is not a decline: retain the operation ID and original key, poll its GET endpoint, or retry the same POST. Run the worker for autonomous recovery.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/payments` | Create/replay a payment |
| `GET /api/v1/payments/:id` | Current canonical payment state |
| `POST /api/v1/refunds` | Create/replay a partial or full refund |
| `GET /api/v1/refunds/:id` | Current canonical refund state |
| `GET /api/v1/ledger/:accountId` | Exact balance and newest 100 entries from one consistent snapshot |
| `POST /api/v1/reconciliation/trigger` | Compare mock provider and internal balance for `{ "provider": "STRIPE", "currency": "USD" }` |
| `GET /api/v1/reconciliation/report` | Latest balance report; amounts are minor units |
| `GET /api/v1/outbox` | Newest 100 events, attempts, errors and delivery state |
| `POST /api/v1/outbox/:id/retry` | Requeue a failed event using the same event ID |
| `GET /api/v1/activity` | Newest 100 deduplicated consumer activity records |

Set `ALLOW_MOCK_SCENARIOS=true` to accept a `scenario` field on payment/refund requests. Available scenarios are `SUCCESS`, `DECLINE`, `TIMEOUT_BEFORE`, and `TIMEOUT_AFTER`. Timeout scenarios fail the initial invocation, then recover through lookup/replay of the same provider key. The chosen scenario is part of the request fingerprint and cannot change during replay.

## Transaction and recovery boundaries

1. Persist the operation and processor attempt together. Refund creation reserves capacity under payment-row locking and serializable isolation.
2. Claim the operation with a recoverable lease. Call the processor outside the database transaction using the attempt's stable provider key.
3. In one transaction, finalize the operation and attempt, insert a balanced journal and its entries on success, and insert a versioned outbox event. Failure to commit leaves the external outcome recoverable.
4. The recovery worker picks up pending/unknown or expired processing operations. It looks up the provider key before replaying it. Exceptions are treated as unknown outcomes, not proof of failed movement of money.
5. The publisher claims events with `FOR UPDATE SKIP LOCKED`, publishes to the durable inbox, then separately marks them published. Delivery retries preserve event IDs, use backoff/jitter, and end in visible `FAILED` state after eight attempts.
6. The activity consumer commits its deduplication record, activity effect and inbox acknowledgment together. A repeated event cannot apply the effect twice.

`MockProcessorOperation` simulates separate provider state with its own commit. It lives in the same PostgreSQL installation for this demo; it does not simulate independent provider infrastructure failures. There is one logical processor attempt per operation; repeated invocations reuse its key. A definitive decline is terminal.

The current accounting model is unchanged: debit provider holding, credit platform revenue for the full payment. Refunds reverse those sides in a new journal. No merchant-fee split has been introduced. Provider balances use debit-minus-credit; the other current account types use credit-minus-debit.

The migration adds row checks, deferred journal-balancing checks and update/delete guards for posted financial history. Operation finalization requires a matching journal amount, type and currency. These are application/database guarantees, not protection against a privileged administrator disabling constraints.

## Migration notes

`20260920090000_payment_lifecycle` builds on the two existing checked-in migrations. It preserves legacy `PaymentEvent` and `Idempotency` rows, introduces new operation/outbox tables, and converts legacy journal major-unit decimals to minor-unit bigint values using currency exponents. Legacy USD-only reconciliation amounts are multiplied by 100.

The migration aborts on unsupported legacy currencies, fractional minor units, unbalanced journals, mixed account currencies, invalid entry sides, duplicate system-account identities, or values outside bigint range. It does not round, merge accounts or reset data. Existing legacy payment-event IDs are blocked from automatic recharging and require manual reconciliation before importing them into the new lifecycle.

The repository had no checked-in migration for the earlier draft Payment/Refund/Outbox schema. If a database was changed using `prisma db push` or an untracked migration, inspect and reconcile that drift before deployment. Do not reset a database containing financial records just to make migrations pass.

## Verification and remaining scope

Run `npm run build`, `npm run lint`, and `npx prisma validate` for routine checks. CI performs schema validation, generation, formatting, lint and build checks; it does not run tests automatically. Existing test files are retained, but new test work requires an explicit request.

This implementation does not finish the full roadmap. External-broker delivery, HTTP webhooks and their DLQ, transaction-level settlement reconciliation, balance projections/rebuilds, OpenTelemetry/metrics, load benchmarks and the operations UI remain future work. Current reconciliation compares balances read at different times and can report temporary differences while operations are in flight. PostgreSQL inbox delivery demonstrates durable handoff and deduplication; it is not a claim of cross-service exactly-once delivery.

See [the backend checklist](docs/BACKEND_CHECKLIST.md) for the original review and current implementation status.
