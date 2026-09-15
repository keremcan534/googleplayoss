import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSuggestResponse } from '../src/suggest.js';

const frame = (inner) => `)]}'\n\n${JSON.stringify([['wrb.fr', 'IJ4APc', JSON.stringify(inner), null, null, null, ''], ['di', 32]])}`;

test('parseSuggestResponse: önerileri sırayla çıkarır', () => {
  const text = frame([[[['offline games', null, []], ['offline rpg', null, []]]], ['CAhKAggD']]);
  assert.deepEqual(parseSuggestResponse(text), ['offline games', 'offline rpg']);
});

test('parseSuggestResponse: boş/null yanıtlarda boş liste', () => {
  assert.deepEqual(parseSuggestResponse(frame(null)), []);
  assert.deepEqual(parseSuggestResponse(frame([[null]])), []);
  assert.deepEqual(parseSuggestResponse(')]}\'\n\n[["wrb.fr","IJ4APc",null,null,null,null,""]]'), []);
  assert.deepEqual(parseSuggestResponse('garbage'), []);
  assert.deepEqual(parseSuggestResponse(')]}\'\n[not json'), []);
});
