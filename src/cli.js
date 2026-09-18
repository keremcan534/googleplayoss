#!/usr/bin/env node
// Tek kelimeyi anında analiz et: node src/cli.js "offline rpg games" [--market us:en] [--json]
import { createStore } from './store.js';
import { analyzeKeyword } from './analyze.js';
import { normalize } from './util.js';
import { VERDICT_LABELS } from './score.js';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const mi = argv.indexOf('--market');
const [country, lang] = (mi >= 0 ? argv[mi + 1] : 'us:en').split(':');
const langArg = (mi >= 0 ? argv[mi + 1] : 'us:en').split(':')[1] || 'en';
const term = normalize(argv.filter((a, i) => !a.startsWith('--') && (mi < 0 || i !== mi + 1)).join(' '), langArg);
if (!term) {
  console.error('Kullanım: node src/cli.js "anahtar kelime" [--market us:en] [--json]');
  process.exit(2);
}

const store = createStore({ country: country || 'us', lang: lang || 'en', throttleMs: 60, concurrency: 4, log: (m) => console.error(m) });
const res = await analyzeKeyword(term, {
  getSuggest: (p) => store.suggest(p),
  search: (t) => store.search(t, 20),
  getApp: async (id) => { const a = await store.app(id); return a && !a.missing ? a : null; },
  topN: 10,
  appConcurrency: 4,
  lang: langArg
});

if (json) {
  console.log(JSON.stringify(res, null, 2));
} else {
  const fmt = (n) => (n === null || n === undefined ? '-' : n.toLocaleString('en-US'));
  console.log(`\n"${term}" (${country}/${lang})`);
  if (res.status === 'no-demand') {
    console.log('Talep: otomatik tamamlamada görünmüyor → ölçülebilir talep yok.');
    if (res.variants.length) console.log('Öneriler:', res.variants.join(' | '));
  } else {
    console.log(`Talep ${res.demand}/100  (en kısa tetikleyici ön ek: ${res.pop.minPrefix} harf "${term.slice(0, res.pop.minPrefix)}", sıra ${res.pop.pos})`);
    console.log(`Zorluk ${res.difficulty}/100   Pazar ${res.market}/100   FIRSAT ${res.opportunity}/100  → ${VERDICT_LABELS[res.verdict]}`);
    const c = res.comp;
    console.log(`Rakipler: ${c.n} uygulama | başlıkta kelime: ${c.titleMatches} | zayıf(<100K): ${c.weak} | düşük puan(<4.0): ${c.lowRated} | bayat(>1y): ${c.stale} | dev(>10M): ${c.big} | ort. puan ${c.avgScore ?? '-'} | toplam yükleme ${fmt(c.sumInstalls)}`);
    console.log('\nİlk 10:');
    for (const a of res.apps.filter(Boolean)) {
      console.log(`  ${String(fmt(a.real)).padStart(14)}  ${String(a.score ?? '-').padStart(4)}  ${(a.updated || '').padEnd(10)}  ${a.title}  (${a.dev})`);
    }
    if (res.variants.length) console.log('\nİlgili öneriler:', res.variants.join(' | '));
  }
  console.log(`\nİstekler: ${JSON.stringify(store.state.used)}`);
}
