import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSec, toParts, fromParts } from '../js/timefmt.js';

test('formatSec', () => {
  assert.equal(formatSec(null), '');
  assert.equal(formatSec(0), '0:00');
  assert.equal(formatSec(45), '0:45');
  assert.equal(formatSec(90), '1:30');
  assert.equal(formatSec(605), '10:05');
  assert.equal(formatSec(-12), '−0:12');
});

test('parts round-trip', () => {
  assert.deepEqual(toParts(125), { m: 2, s: 5 });
  assert.equal(fromParts(2, 5), 125);
});
