import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSize } from '../js/images.js';

test('fitSize shrinks the long edge to 800 keeping aspect', () => {
  assert.deepEqual(fitSize(4000, 3000), { w: 800, h: 600 });
  assert.deepEqual(fitSize(3000, 4000), { w: 600, h: 800 });
});

test('fitSize never upscales', () => {
  assert.deepEqual(fitSize(500, 300), { w: 500, h: 300 });
});
