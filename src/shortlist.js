#!/usr/bin/env node
/*
 * Kısa liste — "yayınlarsam indirme gelir" adayları.
 *
 * Panelin "Gerçekçi" filtresinin komut satırı hali: kararı BUILD ya da GOLD olan
 * VE erişim puanı eşiğin üstünde olan kelimeler. Aynı ilk 10'a düşen kelimeler
 * tek pazar olarak katlanır (varyantlar altta listelenir).
 *
 * Kullanım:
 *   npm run shortlist                 # tüm pazarlar
 *   npm run shortlist -- --market tr-tr
 *   npm run shortlist -- --reach 55 --limit 25
 *   npm run shortlist -- --csv > liste.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOpportunityVerdict, fmtInstalls } from '../public/js/verdict.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DATA = path.join(ROOT, 'public', 'data');
const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };

/** İki kelimenin ilk 10'u bu oranda örtüşüyorsa aynı pazardır. */
const OVERLAP = 0.6;

function overlap(a, b) {
  const A = new Set(a || []);
  const B = new Set(b || []);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

/**
 * Bir pazarın kısa listesi.
 * @returns {{market:object, groups:Array, total:number, counts:object}}
 */
export function shortlistFor(marketId, opts = {}) {
  const { minReach = 65, limit = 30, verdicts = ['GOLD', 'BUILD'] } = opts;
  const data = readJson(path.join(PUBLIC_DATA, `${marketId}.json`));
  if (!data) throw new Error(`Pazar dosyası yok: ${marketId}`);
  const recs = data.keywords.map((r) => ({ ...r, decision: getOpportunityVerdict(r) }));
  const counts = {};
  for (const r of recs) counts[r.decision.verdict] = (counts[r.decision.verdict] || 0) + 1;

  const eligible = recs
    .filter((r) => verdicts.includes(r.decision.verdict))
    .filter((r) => r.decision.reach.has && r.decision.reach.score >= minReach)
    .sort((a, b) => b.decision.reach.score - a.decision.reach.score || b.opportunity - a.opportunity);

  const groups = [];
  for (const r of eligible) {
    const host = groups.find((g) => overlap(g.head.top, r.top) >= OVERLAP);
    if (host) host.variants.push(r);
    else groups.push({ head: r, variants: [] });
  }
  return { market: data.market, generatedAt: data.generatedAt, stats: data.stats, counts, total: eligible.length, groups: groups.slice(0, limit) };
}

function row(r) {
  const x = r.decision.reach;
  const c = r.comp || {};
  return {
    kelime: r.k,
    karar: r.decision.verdict,
    firsat: r.opportunity,
    talep: r.demand,
    rekabet: r.difficulty,
    erisim: x.score,
    giris: x.entry,
    orta_sira: x.midpack,
    yeni_giren: `${x.newcomers}/${x.dated}`,
    lider_payi: x.leaderShare === null ? '' : Math.round(x.leaderShare * 100),
    gelir_modeli: c.monetized ?? '',
    ilgi: c.engagement ?? '',
    gerekce: r.decision.reason
  };
}

function printText(res) {
  const m = res.market;
  console.log('');
  console.log(`=== ${m.label || `${m.country.toUpperCase()} / ${m.lang}`} — ${res.total} aday, ${res.groups.length} ayrı pazar ===`);
  console.log(`veri: ${res.stats.analyzed} puanlı kelime · son tarama ${new Date(res.generatedAt).toLocaleString('tr-TR')}`);
  console.log(`karar dağılımı: ${Object.entries(res.counts).filter(([k]) => k !== 'PENDING').map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  res.groups.forEach((g, i) => {
    const r = g.head;
    const x = r.decision.reach;
    const c = r.comp || {};
    console.log('');
    console.log(`${String(i + 1).padStart(2)}. ${r.k}   [${r.decision.verdict}]`);
    console.log(`    ${r.decision.reason}`);
    console.log(`    talep ${r.demand} · rekabet ${r.difficulty} · fırsat ${r.opportunity} · erişim ${x.score}`);
    console.log(`    giriş ${fmtInstalls(x.entry)} · orta sıra ${fmtInstalls(x.midpack)} · son 2 yılda giren ${x.newcomers}/${x.dated} · lider %${Math.round((x.leaderShare || 0) * 100)}`);
    console.log(`    gelir modeli ${c.monetized ?? '–'}/${c.n ?? '–'} · 1000 yüklemede ${c.engagement ?? '–'} değerlendirme`);
    if (g.variants.length) console.log(`    aynı pazar: ${g.variants.map((v) => v.k).join(', ')}`);
  });
}

function printCsv(all) {
  const cols = ['pazar', 'kelime', 'karar', 'firsat', 'talep', 'rekabet', 'erisim', 'giris', 'orta_sira', 'yeni_giren', 'lider_payi', 'gelir_modeli', 'ilgi', 'varyantlar', 'gerekce'];
  console.log(cols.join(';'));
  for (const res of all) {
    const mid = res.market.id;
    for (const g of res.groups) {
      const r = row(g.head);
      const vals = [mid, r.kelime, r.karar, r.firsat, r.talep, r.rekabet, r.erisim, r.giris, r.orta_sira, r.yeni_giren, r.lider_payi, r.gelir_modeli, r.ilgi, g.variants.map((v) => v.k).join(' | '), r.gerekce];
      console.log(vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  const num = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? Number(argv[i + 1]) : dflt; };
  const mi = argv.indexOf('--market');
  const index = readJson(path.join(PUBLIC_DATA, 'index.json'), { markets: [] });
  const ids = mi >= 0 ? [argv[mi + 1]] : (index.markets || []).map((m) => m.id);
  const opts = { minReach: num('--reach', 65), limit: num('--limit', 30) };
  const all = ids.map((id) => shortlistFor(id, opts));
  if (argv.includes('--csv')) printCsv(all);
  else all.forEach(printText);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
