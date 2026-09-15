#!/usr/bin/env node
// 7/24 tarayıcı: tohumlardan kelime keşfeder, talep ve rekabeti ölçer, public/data/*.json üretir.
// Kullanım: node src/run.js [--market us:en] [--suggest N] [--search N] [--app N] [--minutes N] [--seeds "a,b"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, BudgetError, collections } from './store.js';
import { analyzeKeyword } from './analyze.js';
import { candidatesFromTitles, isValidKeyword } from './discover.js';
import { buildNiches } from './niches.js';
import { normalize, stringifyLines, todayISO, DAY_MS } from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'seeds.json');
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DATA = path.join(ROOT, 'public', 'data');

const SRC_PRIORITY = { seed: 0, suggest: 1, letter: 1, variant: 2, chart: 3, title: 4 };

function log(msg) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, stringifyLines(obj));
  fs.renameSync(tmp, p);
}

function parseArgs(argv) {
  const args = { budget: {} };
  const num = (v) => (v === undefined ? undefined : Number(v));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--market') { args.market = v; i++; } else if (a === '--suggest') { args.budget.suggestCalls = num(v); i++; } else if (a === '--search') { args.budget.searchCalls = num(v); i++; } else if (a === '--app') { args.budget.appCalls = num(v); i++; } else if (a === '--list') { args.budget.listCalls = num(v); i++; } else if (a === '--minutes') { args.budget.maxRunMinutes = num(v); i++; } else if (a === '--seeds') { args.seeds = v.split(',').map((s) => s.trim()).filter(Boolean); i++; }
  }
  const env = process.env;
  if (env.CRAWL_SUGGEST_CALLS) args.budget.suggestCalls = Number(env.CRAWL_SUGGEST_CALLS);
  if (env.CRAWL_SEARCH_CALLS) args.budget.searchCalls = Number(env.CRAWL_SEARCH_CALLS);
  if (env.CRAWL_APP_CALLS) args.budget.appCalls = Number(env.CRAWL_APP_CALLS);
  if (env.CRAWL_MAX_MINUTES) args.budget.maxRunMinutes = Number(env.CRAWL_MAX_MINUTES);
  if (env.CRAWL_MARKET) args.market = env.CRAWL_MARKET;
  if (env.CRAWL_SEEDS) args.seeds = env.CRAWL_SEEDS.split(',').map((s) => s.trim()).filter(Boolean);
  for (const k of Object.keys(args.budget)) if (!Number.isFinite(args.budget[k])) delete args.budget[k];
  return args;
}

/** Yayınlanan dosyaya giren kompakt uygulama kaydı. */
function publicApp(a) {
  return {
    id: a.id, title: a.title, dev: a.dev, genre: a.genre, installs: a.installs, real: a.real,
    score: a.score, ratings: a.ratings, released: a.released, updated: a.updated,
    ads: a.ads, iap: a.iap, free: a.free, price: a.price
  };
}

async function runMarket(cfg, market, args) {
  const id = `${market.country}-${market.lang}`;
  const now = Date.now();
  const today = todayISO(now);
  const budget = { ...(cfg.budget || {}), ...args.budget };
  const store = createStore({
    country: market.country,
    lang: market.lang,
    throttleMs: cfg.throttleMs ?? 350,
    concurrency: cfg.concurrency ?? 2,
    budget: { suggest: budget.suggestCalls, search: budget.searchCalls, app: budget.appCalls, list: budget.listCalls },
    log
  });
  const deadline = now + (budget.maxRunMinutes || 40) * 60_000;
  const timeUp = () => Date.now() > deadline;

  // ---- durum
  const marketDir = path.join(DATA_DIR, id);
  const outPath = path.join(PUBLIC_DATA, `${id}.json`);
  const prev = readJson(outPath, null);
  const apps = readJson(path.join(marketDir, 'apps.json'), {});
  const suggestCache = readJson(path.join(marketDir, 'suggest.json'), {});
  const meta = readJson(path.join(marketDir, 'meta.json'), { runs: 0, letterCursor: 0, catCursor: 0 });
  const kw = new Map();
  for (const r of (prev && prev.keywords) || []) kw.set(r.k, r);
  log(`[${id}] başlıyor: ${kw.size} kelime, ${Object.keys(apps).length} uygulama önbellekte, ${Object.keys(suggestCache).length} öneri önbellekte`);

  const suggestTtl = (cfg.suggestTtlDays || 7) * DAY_MS;
  const appTtl = (cfg.appTtlDays || 21) * DAY_MS;

  async function getSuggest(prefix) {
    const c = suggestCache[prefix];
    if (c && now - c.t < suggestTtl) return c.s;
    const s = await store.suggest(prefix);
    suggestCache[prefix] = { t: Date.now(), s };
    return s;
  }
  function suggestFresh(prefix) {
    const c = suggestCache[prefix];
    return !!(c && now - c.t < suggestTtl);
  }
  async function getApp(appId) {
    const c = apps[appId];
    if (c && now - c.fetched < appTtl) return c.missing ? null : c;
    if (!store.hasBudget('app')) throw new BudgetError('app');
    try {
      const a = await store.app(appId);
      apps[appId] = a;
      return a.missing ? null : a;
    } catch (err) {
      if (err && err.budget) throw err;
      log(`   uygulama alınamadı ${appId}: ${err.message}`);
      return c && !c.missing ? c : null;
    }
  }

  let added = 0;
  function addCandidate(raw, info) {
    const k = normalize(raw);
    if (!isValidKeyword(k)) return null;
    const existing = kw.get(k);
    if (existing) {
      existing.hits = (existing.hits || 0) + (info.hits || 1);
      if (info.knownPrefix && (!existing.knownPrefix || info.knownPrefix < existing.knownPrefix)) existing.knownPrefix = info.knownPrefix;
      if (SRC_PRIORITY[info.src] < SRC_PRIORITY[existing.src]) {
        existing.src = info.src;
        if (info.seed) existing.seed = info.seed;
      }
      return existing;
    }
    if (kw.size >= (budget.maxKeywordsTotal || 8000) && info.src !== 'seed') return null;
    const rec = { k, src: info.src, seed: info.seed || null, first: today, st: 'pending', hits: info.hits || 1, knownPrefix: info.knownPrefix || null };
    kw.set(k, rec);
    added++;
    return rec;
  }

  // ---- 1) tohumlar
  const seeds = (args.seeds || cfg.seeds || []).map(normalize).filter(isValidKeyword);
  const seedSet = new Set(seeds);
  for (const s of seeds) addCandidate(s, { src: 'seed', seed: s });

  // ---- 2) keşif
  const discoveryCap = Math.floor((budget.suggestCalls || 0) * (cfg.discoveryShare ?? 0.35));
  const discoveryStart = store.state.used.suggest;
  const discoveryLeft = () => discoveryCap - (store.state.used.suggest - discoveryStart);
  const letters = (cfg.marketLetters && cfg.marketLetters[market.lang]) || cfg.letters || 'abcdefghijklmnopqrstuvwxyz';

  async function expand(prefix, info) {
    if (!suggestFresh(prefix) && discoveryLeft() <= 0) return false;
    let list;
    try {
      list = await getSuggest(prefix);
    } catch (err) {
      if (err && err.budget) throw err;
      log(`   öneri alınamadı "${prefix}": ${err.message}`);
      return false;
    }
    for (const s of list) addCandidate(s, { ...info, knownPrefix: prefix.length });
    return true;
  }

  log(`[${id}] keşif: ${seeds.length} tohum, keşfe ayrılan öneri çağrısı: ${discoveryCap}`);
  try {
    for (const s of seeds) {
      if (timeUp()) break;
      await expand(s, { src: 'suggest', seed: s });
      await expand(`${s} `, { src: 'suggest', seed: s });
    }
    const promising = [...kw.values()]
      .filter((r) => r.st === 'ok' && r.opportunity >= 40 && !seedSet.has(r.k))
      .sort((a, b) => b.opportunity - a.opportunity)
      .slice(0, 80);
    for (const r of promising) {
      if (timeUp() || discoveryLeft() <= 0) break;
      await expand(`${r.k} `, { src: 'suggest', seed: r.seed || r.k });
    }
    const prefixes = [];
    for (const s of seeds) for (const l of letters) prefixes.push([s, `${s} ${l}`]);
    if (prefixes.length) {
      let cursor = (meta.letterCursor || 0) % prefixes.length;
      let done = 0;
      while (done < prefixes.length && discoveryLeft() > 0 && !timeUp()) {
        const [s, p] = prefixes[cursor];
        await expand(p, { src: 'letter', seed: s });
        cursor = (cursor + 1) % prefixes.length;
        done++;
      }
      meta.letterCursor = cursor;
    }
    const cats = cfg.categories || [];
    const listCap = Math.min(budget.listCalls || 0, cats.length);
    const catCursor = meta.catCursor || 0;
    for (let i = 0; i < listCap; i++) {
      if (timeUp() || store.state.aborted) break;
      const cat = cats[(catCursor + i) % cats.length];
      try {
        const items = await store.list(collections.TOP_FREE, cat, 50);
        for (const c of candidatesFromTitles(items.map((x) => x.title), { minFreq: 2 })) addCandidate(c.k, { src: 'chart', seed: null, hits: c.hits });
      } catch (err) {
        if (err && err.budget) break;
        log(`   liste hatası ${cat}: ${err.message}`);
      }
    }
    if (cats.length) meta.catCursor = (catCursor + listCap) % cats.length;
  } catch (err) {
    if (!(err && err.budget)) throw err;
  }
  log(`[${id}] keşif bitti: +${added} yeni aday, toplam ${kw.size} kelime, öneri çağrısı ${store.state.used.suggest}`);

  // ---- 3) analiz kuyruğu
  const refreshMs = (cfg.refreshDays || 10) * DAY_MS;
  const demandRefreshMs = (cfg.demandRefreshDays || 21) * DAY_MS;
  const noDemandMs = (cfg.noDemandRecheckDays || 30) * DAY_MS;
  const ageOf = (r) => (r.at ? now - new Date(r.at).getTime() : Infinity);
  const pending = [];
  const stale = [];
  for (const r of kw.values()) {
    if (['pending', 'partial', 'error'].includes(r.st)) pending.push(r);
    else if (r.st === 'ok' && ageOf(r) > refreshMs) stale.push(r);
    else if (r.st === 'no-demand' && ageOf(r) > noDemandMs) stale.push(r);
  }
  pending.sort((a, b) => (SRC_PRIORITY[a.src] - SRC_PRIORITY[b.src]) || ((b.hits || 0) - (a.hits || 0)) || a.first.localeCompare(b.first) || a.k.localeCompare(b.k));
  stale.sort((a, b) => ageOf(b) - ageOf(a));
  const queue = [];
  while (pending.length || stale.length) {
    for (let i = 0; i < 3 && pending.length; i++) queue.push(pending.shift());
    if (stale.length) queue.push(stale.shift());
  }
  log(`[${id}] analiz kuyruğu: ${queue.length} kelime (bekleyen + bayat)`);

  function writeOutputs() {
    const records = [...kw.values()].sort((a, b) => a.k.localeCompare(b.k));
    const usedApps = {};
    for (const r of records) {
      for (const appId of r.top || []) {
        const a = apps[appId];
        if (a && !a.missing) usedApps[appId] = publicApp(a);
      }
    }
    const count = (fn) => records.filter(fn).length;
    const stats = {
      keywords: records.length,
      analyzed: count((r) => r.st === 'ok' || r.st === 'partial'),
      withDemand: count((r) => r.demand > 0),
      noDemand: count((r) => r.st === 'no-demand'),
      pending: count((r) => ['pending', 'partial', 'error'].includes(r.st)),
      apps: Object.keys(usedApps).length,
      runs: (meta.runs || 0) + 1
    };
    const out = {
      market: { id, country: market.country, lang: market.lang },
      generatedAt: new Date().toISOString(),
      stats,
      budgetUsed: { ...store.state.used },
      niches: buildNiches(records),
      keywords: records,
      apps: Object.fromEntries(Object.keys(usedApps).sort().map((k) => [k, usedApps[k]]))
    };
    writeJson(outPath, out);

    // önbellek budaması
    const keepSuggest = {};
    for (const [p, c] of Object.entries(suggestCache).sort(([a], [b]) => a.localeCompare(b))) {
      if (Date.now() - c.t < 4 * suggestTtl) keepSuggest[p] = c;
    }
    const keepApps = {};
    for (const appId of Object.keys(apps).sort()) {
      const a = apps[appId];
      if (usedApps[appId] || Date.now() - (a.fetched || 0) < 90 * DAY_MS) keepApps[appId] = a;
    }
    writeJson(path.join(marketDir, 'apps.json'), keepApps);
    writeJson(path.join(marketDir, 'suggest.json'), keepSuggest);
    writeJson(path.join(marketDir, 'meta.json'), { ...meta, runs: stats.runs, lastRun: out.generatedAt });

    const indexPath = path.join(PUBLIC_DATA, 'index.json');
    const index = readJson(indexPath, { markets: [] });
    index.markets = (index.markets || []).filter((m) => m.id !== id);
    index.markets.push({ id, country: market.country, lang: market.lang, generatedAt: out.generatedAt, keywords: stats.keywords, analyzed: stats.analyzed, withDemand: stats.withDemand });
    index.markets.sort((a, b) => a.id.localeCompare(b.id));
    index.generatedAt = out.generatedAt;
    writeJson(indexPath, index);
    return stats;
  }

  let analyzed = 0;
  let sinceCheckpoint = 0;
  try {
  for (const r of queue) {
    if (timeUp()) { log('   süre doldu, analiz durduruluyor'); break; }
    if (store.state.aborted) break;
    const needDemand = !(r.pop && r.pop.minPrefix && r.demandAt && (now - new Date(r.demandAt).getTime()) < demandRefreshMs);
    if (needDemand && !store.hasBudget('suggest')) continue;
    if (!store.hasBudget('search') || !store.hasBudget('app')) { log('   arama/uygulama bütçesi bitti'); break; }
    try {
      const res = await analyzeKeyword(r.k, {
        getSuggest,
        search: (t) => store.search(t, 20),
        getApp,
        topN: cfg.topN || 10,
        knownPrefix: r.knownPrefix || (r.pop && r.pop.minPrefix) || null,
        skipDemand: needDemand ? null : r.pop,
        appConcurrency: cfg.concurrency ?? 2
      });
      if (res.status === 'budget') continue;
      const nowIso = new Date().toISOString();
      r.at = nowIso;
      delete r.err;
      if (res.status === 'no-demand') {
        Object.assign(r, { st: 'no-demand', demand: 0, pop: null, demandAt: nowIso, difficulty: null, market: null, comp: null, opportunity: null, verdict: 'talep-yok', top: [] });
      } else {
        r.st = res.partial ? 'partial' : 'ok';
        r.demand = res.demand;
        r.pop = res.pop;
        r.knownPrefix = res.pop.minPrefix;
        if (!res.skippedDemand) r.demandAt = nowIso;
        Object.assign(r, { difficulty: res.difficulty, market: res.market, comp: res.comp, opportunity: res.opportunity, verdict: res.verdict, top: res.top });
        r.hist = (r.hist || []).filter((h) => h[0] !== today);
        r.hist.push([today, r.demand, r.difficulty, r.opportunity]);
        if (r.hist.length > 30) r.hist = r.hist.slice(-30);
        for (const c of candidatesFromTitles(res.titles || [], { minFreq: 2 })) addCandidate(c.k, { src: 'title', seed: r.seed || r.k, hits: c.hits });
      }
      for (const v of res.variants || []) addCandidate(v, { src: 'variant', seed: r.seed || r.k, knownPrefix: res.variantsPrefixLen || null });
      analyzed++;
      const tag = r.st === 'no-demand' ? 'talep yok' : `talep ${r.demand} zorluk ${r.difficulty} fırsat ${r.opportunity}${r.st === 'partial' ? ' (eksik)' : ''}`;
      log(`   ${String(analyzed).padStart(4)} ${r.k} → ${tag}`);
    } catch (err) {
      if (err && err.budget) { log(`   bütçe bitti (${err.kind})`); if (err.kind === 'suggest') continue; break; }
      r.st = 'error';
      r.err = String(err.message || err).slice(0, 160);
      r.at = new Date().toISOString();
      log(`   hata ${r.k}: ${r.err}`);
    }
    if (++sinceCheckpoint >= 25) { sinceCheckpoint = 0; writeOutputs(); }
  }
  } catch (err) {
    log(`!! beklenmedik hata, eldeki sonuçlar yazılıyor: ${err.message}`);
    writeOutputs();
    throw err;
  }

  const stats = writeOutputs();
  log(`[${id}] bitti: ${analyzed} kelime analiz edildi | toplam ${stats.keywords}, talepli ${stats.withDemand}, bekleyen ${stats.pending} | istekler ${JSON.stringify(store.state.used)} | hata ${store.state.errors}`);
  return stats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = readJson(CONFIG_PATH, null);
  if (!cfg) throw new Error(`Konfigürasyon okunamadı: ${CONFIG_PATH}`);
  let markets = cfg.markets || [{ country: 'us', lang: 'en' }];
  if (args.market) {
    const [country, lang] = args.market.split(':');
    markets = [{ country: country || 'us', lang: lang || 'en' }];
  }
  for (const m of markets) await runMarket(cfg, m, args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
