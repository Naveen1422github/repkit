import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCircuit, flatItems, findItem, mapItems } from '../js/planshape.js';

const set = (id) => ({ id, weight: null, reps: null, duration: null, break: null });
const day = () => [
  { id: 'a', exerciseId: 'ea', sets: [set('a1')] },
  { id: 'c', type: 'circuit', rounds: 3, items: [
    { id: 'b', exerciseId: 'eb', sets: [set('b1')] },
    { id: 'd', exerciseId: 'ed', sets: [set('d1')] },
  ] },
  { id: 'e', exerciseId: 'ee', sets: [set('e1')] },
];

test('legacy entries are exercises', () => {
  assert.equal(isCircuit({ id: 'a', exerciseId: 'x', sets: [] }), false);
  assert.equal(isCircuit(day()[1]), true);
});

test('flatItems expands circuits in order', () => {
  assert.deepEqual(flatItems(day()).map((i) => i.id), ['a', 'b', 'd', 'e']);
});

test('findItem finds nested', () => {
  const r = findItem(day(), 'd');
  assert.equal(r.item.exerciseId, 'ed');
  assert.equal(r.circuit.id, 'c');
  assert.equal(findItem(day(), 'a').circuit, null);
  assert.equal(findItem(day(), 'zzz'), null);
});

test('mapItems returns new arrays and leaves the input untouched', () => {
  const input = day();
  const out = mapItems(input, 'd', (i) => ({ ...i, exerciseId: 'changed' }));
  assert.equal(out[1].items[1].exerciseId, 'changed');
  assert.equal(input[1].items[1].exerciseId, 'ed');
  assert.notEqual(out, input);
  const top = mapItems(input, 'e', (i) => ({ ...i, exerciseId: 'top' }));
  assert.equal(top[2].exerciseId, 'top');
});
