import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup, BACKUP_APP } from '../js/backup.js';

const good = () => ({ app: 'repkit', schemaVersion: 1, exportedAt: '2026-11-24T10:00:00',
  data: { meta: { schemaVersion: 1 }, categories: [], exercises: [], plan: {} } });

test('validateBackup refuses foreign/newer/garbage', () => {
  assert.equal(BACKUP_APP, 'repkit');
  for (const bad of [null, 'x', {}, { schemaVersion: 1, data: { items: [] } }]) {
    const r = validateBackup(bad, 1);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not a repkit backup');
  }
  const newer = { ...good(), schemaVersion: 99 };
  assert.equal(validateBackup(newer, 1).error, 'backup is from a newer repkit — update the app first');
  const partial = good();
  delete partial.data.plan;
  assert.equal(validateBackup(partial, 1).error, 'backup is incomplete');
  const ok = validateBackup(good(), 1);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, good().data);
});
