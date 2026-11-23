import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedSec, remainingSec, cuesBetween } from '../js/timer.js';

test('elapsedSec floors and clamps', () => {
  assert.equal(elapsedSec(1000, 3999), 2);
  assert.equal(elapsedSec(5000, 1000), 0);
});

test('remainingSec goes negative', () => {
  assert.equal(remainingSec(60, 0, 75000), -15);
  assert.equal(remainingSec(60, 0, 75000, 15), 0);
});

test('cuesBetween countdown 3', () => {
  assert.deepEqual(cuesBetween(4, 3, 3), ['tick']);
  assert.deepEqual(cuesBetween(1, 0, 3), ['end']);
  assert.deepEqual(cuesBetween(4, 4, 3), []);
  assert.deepEqual(cuesBetween(6, 5, 3), []);
});

test('cuesBetween overtime every 30s', () => {
  assert.deepEqual(cuesBetween(-29, -30, 3), ['over']);
  assert.deepEqual(cuesBetween(-30, -31, 3), []);
});

test('cuesBetween ignores big jumps', () => {
  assert.deepEqual(cuesBetween(50, -200, 3), []);
});

test('cuesBetween two-step catch-up still fires', () => {
  assert.deepEqual(cuesBetween(2, 0, 3), ['tick', 'end']);
});
