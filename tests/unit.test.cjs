const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMinor, parseCurrency, MAX_MINOR } = require('../dist/domain/money');
const { parseProvider, parseScenario } = require('../dist/domain/operation');

test('money uses exact integers, including values beyond JS safe integers', () => {
  assert.equal(parseMinor('9007199254740993'), 9007199254740993n);
  assert.equal(parseMinor('9223372036854775807'), MAX_MINOR);
  assert.equal(parseMinor(100), 100n);
  for (const value of [0, -1, 0.1, NaN, Infinity, 9007199254740992, '1.5', '1e2', '', null, '9223372036854775808']) {
    assert.throws(() => parseMinor(value), { code: 'INVALID_AMOUNT' });
  }
});

test('currency, provider and scenario validate runtime inputs', () => {
  assert.equal(parseCurrency('JPY'), 'JPY');
  assert.equal(parseCurrency(), 'USD');
  assert.throws(() => parseCurrency('usd'));
  assert.throws(() => parseCurrency('toString'));
  assert.throws(() => parseProvider('FAKE'));
  assert.throws(() => parseScenario('arbitrary'));
});
