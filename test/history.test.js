import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendHistory, readHistory } from '../src/history.js';

test('ileriye dönük kayıt: aylık JSONL dosyasına eklenir ve geri okunur', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gpo-hist-'));
  assert.equal(appendHistory(dir, { date: '2026-10-01', serp: {}, apps: {} }), null, 'boş çalıştırma yazılmaz');
  appendHistory(dir, { date: '2026-10-01', serp: { 'truck simulator': ['a', 'b'] }, apps: { a: 1200 } });
  appendHistory(dir, { date: '2026-10-02', serp: {}, apps: { a: 1350 } });
  appendHistory(dir, { date: '2026-11-01', serp: { x: ['c'] }, apps: {} });
  const rows = readHistory(dir);
  assert.deepEqual(rows.map((r) => r.d), ['2026-10-01', '2026-10-02', '2026-11-01']);
  assert.equal(rows[1].apps.a - rows[0].apps.a, 150);
});
