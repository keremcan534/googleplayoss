#!/usr/bin/env node
/*
 * Yeniden puanlama — AĞA GİTMEDEN.
 *
 * Puanlama mantığı değiştiğinde (ör. başlık eşleşmesinde dolgu kelimelerinin
 * yok sayılması, erişilebilirlik ölçülerinin eklenmesi) daha önce taranmış
 * kelimelerin skorları eski formüle göre kalır. Bu betik, önbellekteki gerçek
 * uygulama verisinden (data/<pazar>/apps.json) her kelimenin rekabet
 * ölçülerini ve fırsat puanını yeniden hesaplar. Yeni istek yapılmaz.
 *
 * Kullanım: npm run rescore  [-- --market us-en] [--dry]
 *
 * Formül değiştiği için trend geçmişi (hist) sıfırlanır: eski ve yeni formülün
 * puanlarını aynı grafikte göstermek yanlış bir trend üretir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreCompetition, opportunityScore, verdict } from './score.js';
import { stringifyLines, todayISO } from './util.js';

export const SCORE_VERSION = 2;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DATA = path.join(ROOT, 'public', 'data');
const DATA = path.join(ROOT, 'data');

const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, stringifyLines(obj));
  fs.renameSync(tmp, p);
}

/**
 * Bir pazar dosyasını yeniden puanlar.
 * @returns {{changed:number, skipped:number, diffs:Array, before:object, after:object}}
 */
export function rescoreMarket(marketId, opts = {}) {
  const { topN = 10, now = Date.now(), quiet = false } = opts;
  const outPath = path.join(PUBLIC_DATA, `${marketId}.json`);
  const data = readJson(outPath);
  if (!data) throw new Error(`Pazar dosyası okunamadı: ${outPath}`);
  const apps = readJson(path.join(DATA, marketId, 'apps.json'), {}) || {};
  const pool = { ...apps, ...(data.apps || {}) };
  const today = todayISO(now);

  let changed = 0;
  let skipped = 0;
  const diffs = [];
  const tally = (recs, key) => recs.reduce((m, r) => { const v = r[key] ?? 'yok'; m[v] = (m[v] || 0) + 1; return m; }, {});
  const before = tally(data.keywords, 'verdict');

  for (const r of data.keywords) {
    if (!(r.st === 'ok' || r.st === 'partial') || !Array.isArray(r.top) || !r.top.length) { skipped++; continue; }
    const list = r.top.map((id) => pool[id]).filter((a) => a && !a.missing);
    if (!list.length) { skipped++; continue; }
    const { difficulty, market, comp } = scoreCompetition(r.k, list, { topN, now });
    const opportunity = opportunityScore(r.demand, difficulty, comp);
    const was = { difficulty: r.difficulty, opportunity: r.opportunity, titleMatches: r.comp?.titleMatches };
    r.difficulty = difficulty;
    r.market = market;
    r.comp = comp;
    r.opportunity = opportunity;
    r.verdict = verdict(opportunity, r.demand);
    r.st = list.length < Math.min(topN, r.top.length) ? 'partial' : 'ok';
    // formül değişti: eski puanlarla trend çizmek yanlış olur
    r.hist = [[today, r.demand, difficulty, opportunity]];
    if (was.difficulty !== difficulty || was.opportunity !== opportunity) {
      changed++;
      diffs.push({ k: r.k, dOpp: (opportunity ?? 0) - (was.opportunity ?? 0), dDiff: (difficulty ?? 0) - (was.difficulty ?? 0), was, now: { difficulty, opportunity, titleMatches: comp.titleMatches } });
    }
  }

  const after = tally(data.keywords, 'verdict');
  data.scoreVersion = SCORE_VERSION;
  data.rescoredAt = new Date(now).toISOString();
  data.generatedAt = data.generatedAt || new Date(now).toISOString();

  if (!opts.dry) {
    // yayınlanan uygulama listesini de tazele (yeni alanlar: released vs.)
    const used = {};
    for (const r of data.keywords) for (const id of r.top || []) {
      const a = pool[id];
      if (a && !a.missing) {
        used[id] = {
          id: a.id, title: a.title, dev: a.dev, genre: a.genre, installs: a.installs, real: a.real,
          score: a.score, ratings: a.ratings, released: a.released, updated: a.updated,
          ads: a.ads, iap: a.iap, free: a.free, price: a.price
        };
      }
    }
    data.apps = Object.fromEntries(Object.keys(used).sort().map((k) => [k, used[k]]));
    writeJson(outPath, data);
  }
  if (!quiet) {
    console.log(`[${marketId}] ${changed} kelimenin puanı değişti, ${skipped} kelime atlandı (analiz edilmemiş).`);
    console.log(`  önce: ${JSON.stringify(before)}`);
    console.log(`  sonra: ${JSON.stringify(after)}`);
  }
  return { changed, skipped, diffs, before, after };
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const mi = argv.indexOf('--market');
  const index = readJson(path.join(PUBLIC_DATA, 'index.json'), { markets: [] });
  const ids = mi >= 0 ? [argv[mi + 1]] : (index.markets || []).map((m) => m.id);
  if (!ids.length) { console.log('Yeniden puanlanacak pazar yok.'); return; }
  for (const id of ids) {
    const res = rescoreMarket(id, { dry });
    const top = res.diffs.slice().sort((a, b) => Math.abs(b.dOpp) - Math.abs(a.dOpp)).slice(0, 12);
    if (top.length) {
      console.log('  en çok değişenler:');
      for (const t of top) {
        console.log(`    ${t.k.padEnd(34)} fırsat ${String(t.was.opportunity).padStart(3)} → ${String(t.now.opportunity).padStart(3)} (zorluk ${t.was.difficulty} → ${t.now.difficulty}, başlıkta ${t.was.titleMatches} → ${t.now.titleMatches})`);
      }
    }
    if (dry) console.log('  (--dry: dosya yazılmadı)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
