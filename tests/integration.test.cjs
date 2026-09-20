const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

// Never silently run financial fixtures against the application's configured DB.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !/^ledger_test(?:_|$)/.test(new URL(testUrl).pathname.slice(1))) {
  throw new Error('Set TEST_DATABASE_URL to a dedicated database named ledger_test or ledger_test_*');
}
process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET = 'integration-only-secret-not-for-deployment';
process.env.ALLOW_MOCK_SCENARIOS = 'true';

const { PrismaClient } = require('@prisma/client');
const { prisma } = require('../dist/config/prisma');
const { PaymentService } = require('../dist/services/PaymentService.service');
const { LedgerService } = require('../dist/services/LedgerService.service');
const { OutboxService } = require('../dist/services/OutboxService.service');
const { OutboxPublisher, DatabaseInboxTransport } = require('../dist/workers/outboxPublisher');
const { ActivityConsumer } = require('../dist/workers/activityConsumer');
const db = new PrismaClient();
const service = new PaymentService({ db, retryDelayMs: 0 });
const scope = `test:${randomUUID()}`;
const request = (extra = {}) => ({ amountMinor: '10000', provider: 'STRIPE', currency: 'USD', ...extra });
const pay = (extra = {}) => service.processPayment(request(extra), randomUUID(), scope);
after(async () => { await db.$disconnect(); await prisma.$disconnect(); });

async function assertPaymentJournal(payment) {
  const journal = await db.transaction.findUniqueOrThrow({ where: { id: payment.transactionId }, include: { entries: true } });
  assert.equal(journal.entries.reduce((sum, e) => sum + e.debitMinor, 0n), BigInt(payment.amountMinor));
  assert.equal(journal.entries.reduce((sum, e) => sum + e.creditMinor, 0n), BigInt(payment.amountMinor));
  assert.equal(await db.outboxEvent.count({ where: { aggregateId: payment.paymentId } }), 1);
}

test('success atomically posts the payment, attempt, journal and versioned event', async () => {
  const payment = await pay({ amountMinor: '9007199254740993', currency: 'JPY' });
  assert.equal(payment.status, 'SUCCEEDED');
  await assertPaymentJournal(payment);
  const attempt = await db.processorAttempt.findUniqueOrThrow({ where: { paymentId: payment.paymentId } });
  assert.equal(attempt.status, 'SUCCEEDED');
  assert.equal(attempt.invocations, 1);
  assert.equal(attempt.externalRef, payment.externalRef);
  const event = await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: payment.paymentId } });
  assert.equal(event.version, 1);
  assert.equal(event.payload.amountMinor, '9007199254740993');
});

test('decline has no journal and cannot turn into success on replay', async () => {
  const key = randomUUID();
  const input = request({ scenario: 'DECLINE' });
  const first = await service.processPayment(input, key, scope);
  assert.equal(first.status, 'FAILED');
  assert.equal(first.transactionId, null);
  assert.deepEqual(await service.processPayment(input, key, scope), first);
  assert.equal(await db.transaction.count({ where: { externalRef: `payment:${first.paymentId}` } }), 0);
  assert.equal(await db.outboxEvent.count({ where: { aggregateId: first.paymentId, eventType: 'PAYMENT_FAILED' } }), 1);
});

test('30 simultaneous duplicate requests produce one charge and one posting', async () => {
  const key = randomUUID();
  const input = request();
  const results = await Promise.all(Array.from({ length: 30 }, () => service.processPayment(input, key, scope)));
  assert.equal(new Set(results.map((r) => r.paymentId)).size, 1);
  const payment = await service.processPayment(input, key, scope);
  assert.equal(payment.status, 'SUCCEEDED');
  await assertPaymentJournal(payment);
  assert.equal(await db.mockProcessorOperation.count({ where: { id: `payment:${payment.paymentId}` } }), 1);
});

test('changed payload and second key for the same payment ID conflict', async () => {
  const key = randomUUID();
  const input = request({ paymentId: randomUUID() });
  const original = await service.processPayment(input, key, scope);
  await assert.rejects(service.processPayment({ ...input, amountMinor: '1' }, key, scope), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.processPayment(input, randomUUID(), scope), { code: 'PAYMENT_ID_CONFLICT' });
  assert.deepEqual(await service.processPayment(input, key, scope), original);
});

test('idempotency is scoped to principal and operation type', async () => {
  const key = randomUUID();
  const first = await service.processPayment(request(), key, scope);
  const second = await service.processPayment(request(), key, `${scope}:other`);
  assert.notEqual(first.paymentId, second.paymentId);
  await assert.rejects(service.getPayment(first.paymentId, `${scope}:other`), { code: 'PAYMENT_NOT_FOUND' });
  const refund = await service.processRefund({ paymentId: first.paymentId, amountMinor: '1' }, key, scope);
  assert.equal(refund.status, 'SUCCEEDED');
});

test('timeout before and after processor execution recover with a stable key', async () => {
  for (const scenario of ['TIMEOUT_BEFORE', 'TIMEOUT_AFTER']) {
    const key = randomUUID();
    const input = request({ scenario });
    const first = await service.processPayment(input, key, scope);
    assert.equal(first.status, 'UNKNOWN');
    assert.equal(first.transactionId, null);
    const expected = scenario === 'TIMEOUT_AFTER' ? 1 : 0;
    assert.equal(await db.mockProcessorOperation.count({ where: { id: `payment:${first.paymentId}` } }), expected);
    const restartedService = new PaymentService({ db, retryDelayMs: 0 });
    const recovered = await restartedService.processPayment(input, key, scope);
    assert.equal(recovered.status, 'SUCCEEDED');
    await assertPaymentJournal(recovered);
    assert.equal(await db.mockProcessorOperation.count({ where: { id: `payment:${first.paymentId}` } }), 1);
  }
});

test('outbox failure rolls back local success and every journal line, then recovers', async () => {
  class FailingOutbox extends OutboxService {
    async createEvent() { throw new Error('injected outbox failure'); }
  }
  const failing = new PaymentService({ db, outbox: new FailingOutbox(), retryDelayMs: 0 });
  const key = randomUUID();
  const input = request();
  const first = await failing.processPayment(input, key, scope);
  assert.equal(first.status, 'UNKNOWN');
  assert.equal(first.transactionId, null);
  assert.equal(await db.transaction.count({ where: { externalRef: `payment:${first.paymentId}` } }), 0);
  assert.equal(await db.outboxEvent.count({ where: { aggregateId: first.paymentId } }), 0);
  assert.equal(await db.mockProcessorOperation.count({ where: { id: `payment:${first.paymentId}` } }), 1);
  const recovered = await service.processPayment(input, key, scope);
  assert.equal(recovered.status, 'SUCCEEDED');
  await assertPaymentJournal(recovered);
});

test('process termination after processor commit is recovered by another process', async () => {
  const id = randomUUID();
  const child = spawn(process.execPath, ['tests/crash-worker.cjs', id, scope], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  assert.equal(code, 73, stderr);
  const before = await db.payment.findUniqueOrThrow({ where: { id } });
  assert.equal(before.status, 'PROCESSING');
  assert.equal(before.ledgerTransactionId, null);
  assert.equal(await db.mockProcessorOperation.count({ where: { id: `payment:${id}` } }), 1);
  // Simulate lease expiry rather than sleeping for 30 seconds.
  await db.payment.update({ where: { id }, data: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) } });
  await new PaymentService({ db, retryDelayMs: 0 }).recoverPending();
  const recovered = await service.getPayment(id, scope);
  assert.equal(recovered.status, 'SUCCEEDED');
  await assertPaymentJournal(recovered);
});

test('concurrent refunds reserve capacity and preserve the original journal', async () => {
  const payment = await pay();
  const original = await db.transaction.findUniqueOrThrow({ where: { id: payment.transactionId }, include: { entries: true } });
  const results = await Promise.allSettled([1, 2].map(() => service.processRefund({ paymentId: payment.paymentId, amountMinor: '6000' }, randomUUID(), scope)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'OVER_REFUND');
  const final = await service.processRefund({ paymentId: payment.paymentId, amountMinor: '4000' }, randomUUID(), scope);
  assert.equal(final.status, 'SUCCEEDED');
  const reversal = await db.transaction.findUniqueOrThrow({ where: { id: final.transactionId } });
  assert.equal(reversal.reversalOfId, payment.transactionId);
  assert.deepEqual(await db.transaction.findUniqueOrThrow({ where: { id: payment.transactionId }, include: { entries: true } }), original);
});

test('unknown refunds retain capacity; declined refunds release it', async () => {
  const payment = await pay();
  const key = randomUUID();
  const input = { paymentId: payment.paymentId, amountMinor: '10000', scenario: 'TIMEOUT_AFTER' };
  const pending = await service.processRefund(input, key, scope);
  assert.equal(pending.status, 'UNKNOWN');
  await assert.rejects(service.processRefund({ paymentId: payment.paymentId, amountMinor: '1' }, randomUUID(), scope), { code: 'OVER_REFUND' });
  assert.equal((await service.processRefund(input, key, scope)).status, 'SUCCEEDED');
  const other = await pay();
  const declined = await service.processRefund({ paymentId: other.paymentId, amountMinor: '10000', scenario: 'DECLINE' }, randomUUID(), scope);
  assert.equal(declined.status, 'FAILED');
  const replacement = await service.processRefund({ paymentId: other.paymentId, amountMinor: '10000' }, randomUUID(), scope);
  assert.equal(replacement.status, 'SUCCEEDED');
});

test('database rejects journal mutation, unbalanced inserts and extra entries', async () => {
  const payment = await pay();
  const journal = await db.transaction.findUniqueOrThrow({ where: { id: payment.transactionId }, include: { entries: true } });
  await assert.rejects(db.transaction.update({ where: { id: journal.id }, data: { amountMinor: 1n } }));
  await assert.rejects(db.ledgerEntry.delete({ where: { id: journal.entries[0].id } }));
  await assert.rejects(db.account.update({ where: { id: journal.entries[0].accountId }, data: { currency: 'EUR' } }));
  await assert.rejects(db.transaction.create({ data: {
    type: 'ADJUSTMENT', amountMinor: 1n, currency: 'USD',
    entries: { create: [{ accountId: journal.entries[0].accountId, debitMinor: 1n, creditMinor: 0n }] },
  } }));
  await assert.rejects(db.ledgerEntry.create({ data: {
    transactionId: journal.id, accountId: journal.entries[0].accountId, debitMinor: 1n, creditMinor: 0n,
  } }));
  await assert.rejects(db.payment.update({ where: { id: payment.paymentId }, data: { status: 'FAILED', ledgerTransactionId: null } }));
});

test('ledger service rejects invalid sides and mismatched currencies', async () => {
  const ledger = new LedgerService(db);
  const payment = await pay();
  const entries = await db.ledgerEntry.findMany({ where: { transactionId: payment.transactionId } });
  for (const currency of ['USD', 'EUR']) {
    await assert.rejects(db.$transaction((tx) => ledger.recordTransaction(tx, {
      type: 'ADJUSTMENT', amountMinor: 1n, currency, externalRef: randomUUID(),
      entries: currency === 'USD'
        ? [{ accountId: entries[0].accountId, debitMinor: 1n, creditMinor: 1n }, { accountId: entries[1].accountId, debitMinor: 0n, creditMinor: 0n }]
        : [{ accountId: entries[0].accountId, debitMinor: 1n, creditMinor: 0n }, { accountId: entries[1].accountId, debitMinor: 0n, creditMinor: 1n }],
    })));
  }
});

test('outbox redelivery after lost acknowledgment creates one durable activity', async () => {
  const payment = await pay();
  const inbox = new DatabaseInboxTransport(db);
  const publisher = new OutboxPublisher(db, { async publish(event) {
    await inbox.publish(event);
    if (event.aggregateId === payment.paymentId) throw new Error('injected crash after receipt before publication mark');
  } });
  await publisher.publishBatch(200);
  const event = await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: payment.paymentId } });
  assert.equal(event.status, 'PENDING');
  assert.equal(await db.inboxEvent.count({ where: { id: event.id } }), 1);
  await db.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date(0) } });
  await new OutboxPublisher(db).publishBatch(200);
  await Promise.all([new ActivityConsumer(db).consumeBatch(200), new ActivityConsumer(db).consumeBatch(200)]);
  assert.equal(await db.systemActivity.count({ where: { eventId: event.id } }), 1);
  assert.equal(await db.processedEvent.count({ where: { eventId: event.id } }), 1);
  // Simulate a redelivered ACK after the effect was committed.
  await db.inboxEvent.update({ where: { id: event.id }, data: { consumedAt: null } });
  await new ActivityConsumer(db).consumeBatch(200);
  assert.equal(await db.systemActivity.count({ where: { eventId: event.id } }), 1);
});

test('exhausted outbox delivery can be requeued without changing event identity', async () => {
  const payment = await pay();
  await new OutboxPublisher(db, { async publish() { throw new Error('transport offline'); } }, 1).publishBatch(200);
  const event = await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: payment.paymentId } });
  assert.equal(event.status, 'FAILED');
  const publisher = new OutboxPublisher(db);
  assert.equal((await publisher.retryFailed(event.id)).count, 1);
  await publisher.publishBatch(200);
  assert.equal((await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status, 'PUBLISHED');
});

test('HTTP contract authenticates, validates minor units and replays canonical results', async () => {
  const app = require('../dist/app').default;
  const jwt = require('jsonwebtoken');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/v1`;
  const headers = {
    'content-type': 'application/json', 'x-idempotency-key': randomUUID(),
    authorization: `Bearer ${jwt.sign({ sub: scope }, process.env.JWT_SECRET, { expiresIn: '5m' })}`,
  };
  try {
    assert.equal((await fetch(`${url}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${url}/payments`, { method: 'POST', headers, body: JSON.stringify({ amount: 100, provider: 'STRIPE' }) })).status, 400);
    const response = await fetch(`${url}/payments`, { method: 'POST', headers, body: JSON.stringify(request()) });
    assert.equal(response.status, 200);
    const payment = await response.json();
    const replay = await fetch(`${url}/payments`, { method: 'POST', headers, body: JSON.stringify(request()) });
    assert.deepEqual(await replay.json(), payment);
    const detail = await fetch(`${url}/payments/${payment.paymentId}`, { headers });
    assert.deepEqual(await detail.json(), payment);
    assert.equal((await fetch(`${url}/reconciliation/trigger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
