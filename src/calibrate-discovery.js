#!/usr/bin/env node
/*
 * Keşif skoru geri besleme raporu — Fabrika'nın yayınladığı uygulamaların sonuçları etiket olarak.
 *
 * Her uygulama, seçildiği kelimeye bağlanır; kelimenin SEÇİM ANINDAKİ ilk 10'u ileriye dönük kayıttan
 * (data/<pazar>/history) kurulur ve Fabrika'nın kendi uygulaması çıkarılır (başarılı bir uygulama sonradan o
 * kelimenin ilk 10'una girip sinyalleri kendi lehine değiştirmesin). Sonra:
 *   - her uygulamanın etiketi (başarılı / zayıf / orta / bekliyor) ve beş sinyali yazdırılır,
 *   - kesinleşmiş başarılı ve zayıflar üzerinde her sinyalin AUC'si hesaplanır,
 *   - kapı açıksa (≥ 20 etiket, her sınıftan ≥ 4) öncüle doğru büzülmüş yeni ağırlık önerilir.
 *
 * Sonuç dosyası herkese açık depoya konmaz (Play Console verisi): varsayılan yol data/factory/outcomes.json
 * .gitignore'dadır; başka bir yer için --outcomes ya da FACTORY_OUTCOMES. Biçim: data/factory/outcomes.example.json.
 *
 * Kullanım:
 *   npm run calibrate-discovery
 *   npm run calibrate-discovery -- --outcomes ../aso-tracker/outcomes.json
 *   npm run calibrate-discovery -- --write    # config/discovery.json: etiket özeti; kapı açıksa ağırlıklar
 *   npm run calibrate-discovery -- --json     # makine okunur çıktı
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOpportunityVerdict } from '../public/js/verdict.js';
import { buildFlagContext } from '../public/js/flags.js';
import { discoveryScore, normWeights, SIGNALS, SIGNAL_TR, PRIOR_WEIGHTS } from '../public/js/discovery.js';
import { labelOutcome, genericRanks, proposeWeights, serpAt, FIT } from './outcomes.js';
import { readHistory } from './history.js';
import { DISCOVERY_CONFIG, readDiscoveryConfig } from './publish.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
export const DEFAULT_OUTCOMES = path.join(ROOT, 'data', 'factory', 'outcomes.json');

/** Pazar başına bir kez: veri seti, bağlam, geçmiş, uygulama havuzu. */
function marketLoader() {
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const data = readJson(path.join(ROOT, 'public', 'data', `${id}.json`));
    const m = data ? {
      data,
      ctx: buildFlagContext(data),
      history: readHistory(path.join(ROOT, 'data', id)),
      // önbellekteki uygulamalar eski ilk 10'ları da çözer; yayınlanan kayıt (cx ile) önceliklidir
      apps: { ...(readJson(path.join(ROOT, 'data', id, 'apps.json'), {}) || {}), ...(data.apps || {}) }
    } : null;
    cache.set(id, m);
    return m;
  };
}

/**
 * @param {Array} outcomes Fabrika satırları
 * @param {{now?:number, cfg?:object, load?:Function}} opts
 */
export function evaluateOutcomes(outcomes, opts = {}) {
  const now = opts.now ?? Date.now();
  const cfg = opts.cfg || readDiscoveryConfig();
  const load = opts.load || marketLoader();
  const rows = [];
  for (const o of outcomes || []) {
    const market = o.market || 'us-en';
    const lang = market.split('-')[1] || 'en';
    const lab = labelOutcome(o, now);
    const row = { name: o.name || o.app || '?', app: o.app || null, market, keyword: o.keyword || null, ...lab, generic: genericRanks(o, lang), score: null, signals: null, note: null };
    rows.push(row);
    const m = load(market);
    const r = m && o.keyword ? m.ctx.byK.get(o.keyword) : null;
    if (!o.keyword) { row.note = 'radar kelimesi yok'; continue; }
    if (!m) { row.note = `pazar verisi yok (${market})`; continue; }
    if (!r) { row.note = 'kelime veri setinde yok'; continue; }
    const past = serpAt(m.history, o.keyword, o.pickedAt);
    const top = (past ? past.top : r.top || []).filter((id) => id !== o.app);
    // seçim anının ilk 10'u varsa dünkü bant (histerezis) ona ait değildir; yoksa arayüzün bugün gösterdiğiyle aynı
    const rec = { ...r, top, vprev: past ? null : r.vprev };
    const pickedAt = Date.parse(o.pickedAt || '') || now;
    const decision = getOpportunityVerdict(rec, { ctx: m.ctx, appsMap: m.apps, now: pickedAt });
    const model = { weights: cfg.weights, visual: (cfg.visual || {})[market], feasibility: (cfg.feasibility || {})[market] };
    const res = discoveryScore(rec, m.apps, { decision, seed: r.seed ? m.ctx.byK.get(r.seed) : null, marketApps: m.apps, model, lang });
    row.serpFrom = past ? past.d : 'bugün';
    row.verdict = decision.verdict;
    if (!res) { row.note = 'skor hesaplanamadı (karar yok)'; continue; }
    row.score = res.score;
    row.signals = Object.fromEntries(SIGNALS.map((s) => [s, res.signals[s].value]));
  }
  const fit = proposeWeights(rows.filter((r) => r.final && r.signals), normWeights(cfg.weights || PRIOR_WEIGHTS), { minLabels: cfg.minLabels ?? FIT.minLabels, minPerClass: cfg.minPerClass ?? FIT.minPerClass });
  const count = (f) => rows.filter(f).length;
  const summary = {
    at: new Date(now).toISOString().slice(0, 10),
    apps: rows.length,
    labelled: count((r) => r.final && (r.label === 'success' || r.label === 'weak')),
    success: count((r) => r.final && r.label === 'success'),
    weak: count((r) => r.final && r.label === 'weak'),
    mid: count((r) => r.final && r.label === 'mid'),
    pending: count((r) => !r.final),
    gateOpen: fit.open,
    scoreAuc: fit.scoreAuc === null ? null : Math.round(fit.scoreAuc * 100) / 100
  };
  return { rows, fit, summary };
}

const LABEL_TR = { success: 'BAŞARILI', weak: 'ZAYIF', mid: 'ORTA', pending: 'BEKLİYOR' };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '  – ');

function printReport(res, cfg) {
  const { rows, fit, summary } = res;
  console.log(`\nKeşif skoru geri besleme raporu — ${summary.at}`);
  console.log(`ağırlıklar: ${SIGNALS.map((s) => `${s} ${normWeights(cfg.weights)[s].toFixed(2)}`).join(' · ')} (${cfg.weightsSource || 'öncül'})\n`);
  console.log(`${'uygulama'.padEnd(26)}${'etiket'.padEnd(11)}${'skor'.padStart(5)}  ${SIGNALS.map((s) => s.slice(0, 5).padStart(6)).join('')}   kelime`);
  for (const r of rows.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1))) {
    const lab = r.final ? LABEL_TR[r.label] : `${LABEL_TR.pending}${r.lean ? `(${r.lean === 'weak' ? 'z' : 'o'})` : ''}`;
    const sig = r.signals ? SIGNALS.map((s) => f2(r.signals[s]).padStart(6)).join('') : ''.padStart(30);
    console.log(`${String(r.name).slice(0, 25).padEnd(26)}${lab.padEnd(11)}${String(r.score ?? '–').padStart(5)}  ${sig}   ${r.keyword || '–'}${r.verdict ? ` [${r.verdict}]` : ''}${r.note ? `  (${r.note})` : ''}`);
    if (r.generic.own) console.log(`${''.padEnd(26)}↳ ${r.generic.own} marka araması (kendi adı) yok sayıldı; en iyi genel sıra: ${r.generic.best ?? 'yok'}`);
  }
  console.log(`\netiketler: ${summary.success} başarılı · ${summary.weak} zayıf · ${summary.mid} orta · ${summary.pending} bekliyor (28 günlük pencere dolmadı)`);
  console.log(`sinyal AUC (başarılı > zayıf): ${SIGNALS.map((s) => `${SIGNAL_TR[s]} ${f2(fit.aucs[s])}`).join(' · ')} · skor ${f2(fit.scoreAuc)}`);
  if (fit.n && fit.n < 10) console.log('  (çok az etiket: AUC değerleri gürültüdür, karar için kullanma)');
  console.log(fit.reason);
  if (fit.open) console.log(`önerilen ağırlıklar: ${SIGNALS.map((s) => `${s} ${fit.weights[s].toFixed(2)}`).join(' · ')}`);
}

function main() {
  const argv = process.argv.slice(2);
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const file = val('--outcomes') || process.env.FACTORY_OUTCOMES || DEFAULT_OUTCOMES;
  const doc = readJson(file);
  if (!doc) {
    console.error(`Sonuç dosyası okunamadı: ${file}\nBiçim için data/factory/outcomes.example.json'a bak; dosyayı oraya koy ya da --outcomes / FACTORY_OUTCOMES ile göster.`);
    process.exit(1);
  }
  const cfg = readDiscoveryConfig();
  const res = evaluateOutcomes(Array.isArray(doc) ? doc : doc.apps || [], { cfg });
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else printReport(res, cfg);
  if (argv.includes('--write')) {
    const next = { ...cfg, calibration: res.summary };
    if (res.fit.open) {
      next.weights = res.fit.weights;
      next.weightsSource = `kalibre: ${res.fit.n} etiketli uygulama, λ ${res.fit.lambda} (${res.summary.at})`;
    }
    fs.writeFileSync(DISCOVERY_CONFIG, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\n${path.relative(ROOT, DISCOVERY_CONFIG)} yazıldı: etiket özeti${res.fit.open ? ' + yeni ağırlıklar' : ' (ağırlıklar değişmedi: kapı kapalı)'}. Yayınlanan veriye bir sonraki taramada ya da 'npm run rescore' ile girer.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
