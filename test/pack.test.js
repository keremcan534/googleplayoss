import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, generatePack, readiness, editText, setStatus, exportFiles, importFiles, STAGES, ITEMS, STATUS, normalizeProject } from '../public/js/pack/pack.js';
import { lintField, generateTitles, LIMITS } from '../public/js/pack/aso.js';
import { buildChecks, dataSafetyDraft, privacyPolicy, ratingPrep } from '../public/js/pack/compliance.js';
import { screenshotPlan, socialVideoPlans } from '../public/js/pack/marketing.js';
import { analyzeProduct } from '../public/js/pack/product.js';
import { summarizeRepo } from '../public/js/pack/repo.js';
import { TRUCK_FILES, TRUCK_PATHS } from './fixtures/truck-repo.js';

const repo = summarizeRepo(TRUCK_FILES, TRUCK_PATHS, { url: 'https://github.com/anatolia/road-haul', repo: 'road-haul' });
const ids = (p) => Array.from({ length: 10 }, (_, i) => `${p}.${i}`);
const comp = { n: 10, titleMatches: 3, weak: 3, lowRated: 2, stale: 2, big: 2, ads: 8, iap: 5, paid: 0, monetized: 9, engagement: 4, avgScore: 4.0,
  medianInstalls: 300000, sumInstalls: 9e6, entry: 20000, entry2: 40000, tiny: 1, midpack: 200000, leaderShare: 0.4, newcomers: 3, dated: 4, medianAgeYears: 3 };
const liveResult = (k, demand, opportunity, p) => ({ k, status: 'ok', demand, difficulty: 45, market: 60, opportunity, comp, pop: { minPrefix: 6 },
  apps: ids(p).map((id, i) => ({ id, title: `Truck Driver ${i}`, dev: `dev-${p}-${i}`, real: (10 - i) * 1e5, score: 4.1, ratings: 900, ads: true, iap: true, updated: '2026-05-01', released: i < 4 ? '2025-08-01' : '2019-01-01' })) });

function ctx(extra = {}) {
  const calls = { suggest: [], analyze: [] };
  const LIVE = { 'truck simulator': [70, 62, 'a'], 'cargo truck': [45, 58, 'b'], 'truck driving': [40, 50, 'c'], 'truck games': [66, 55, 'a'] };
  return {
    calls,
    dataset: { keywords: [
      { k: 'euro truck simulator', st: 'ok', demand: 90, opportunity: 70, difficulty: 40, market: 70, comp, top: ids('e') },
      { k: 'trailer truck', st: 'ok', demand: 35, opportunity: 52, difficulty: 40, market: 60, comp, top: ids('t'), pop: { minPrefix: 7 } },
      { k: 'bus simulator', st: 'ok', demand: 80, opportunity: 65, difficulty: 40, market: 60, comp, top: ids('x') }
    ], apps: {} },
    suggest: async (q) => { calls.suggest.push(q); return q.startsWith('truck') ? ['truck simulator', 'truck simulator 2024', 'truck parking offline'] : []; },
    analyze: async (k) => { calls.analyze.push(k); const v = LIVE[k]; return v ? liveResult(k, v[0], v[1], v[2]) : { k, status: 'no-demand', demand: 0, apps: [] }; },
    ...extra
  };
}

test('proje: keşif olmadan oluşturulur, tüm kalemler EKSİK başlar, hazırlık %0', () => {
  const p = createProject({ name: 'Road Haul', market: 'us-en', origin: 'import', inputs: { repo } });
  assert.equal(p.origin, 'import');
  assert.equal(Object.keys(p.pack.items).length, ITEMS.length);
  assert.ok(Object.values(p.pack.items).every((i) => i.status === STATUS.MISSING));
  assert.equal(readiness(p).pct, 0);
  assert.equal(STAGES.length, 16);
  assert.throws(() => createProject({ name: ' ' }));
});

test('yayın paketi: 16 aşama, dürüst konumlandırma, metinler, uyumluluk', async () => {
  const p = createProject({ name: 'Road Haul', market: 'us-en', origin: 'import', inputs: { repo } });
  const c = ctx();
  const seen = [];
  await generatePack(p, { ...c, onStage: (id, st) => { if (st === 'done') seen.push(id); } });
  assert.deepEqual(seen, STAGES.map((s) => s.id));
  const it = p.pack.items;
  assert.equal(p.pack.positioning.primary.k, 'truck simulator');
  const ex = Object.fromEntries(p.pack.positioning.excluded.map((e) => [e.k, e.why]));
  assert.ok(!('euro truck simulator' in ex) || /Marka/.test(ex['euro truck simulator']));
  assert.ok(!p.pack.candidates.some((x) => x.k === 'euro truck simulator' || x.k === 'bus simulator'), 'marka ve ilgisiz kelime aday havuzuna girmez');
  assert.ok(!c.calls.analyze.includes('truck simulator 2024'), 'yıllı öneri ürünle uyumsuz: ölçülmez');
  assert.equal(it.primary.status, STATUS.READY);
  assert.ok(it.title.value.text.length <= LIMITS.title);
  assert.equal(it.title.value.text, 'Road Haul: Truck Simulator');
  assert.ok(it.short.value.text.length <= LIMITS.short);
  assert.match(it.full.value.text, /Looking for a truck simulator\?/);
  assert.equal(it.full.status, STATUS.NEEDS_REVIEW, 'repo taramasından gelen iddialar doğrulanmalı');
  assert.equal(it.category.value.id, 'GAME_SIMULATION');
  assert.equal(it.icon.status, STATUS.MISSING, 'Node\'da çizici yok: brif hazır, dosya eksik');
  assert.ok(it.icon.value.brief.icon.concept);
  assert.equal(it.screenshots.status, STATUS.MISSING);
  assert.ok(it.captions.value.slides.length >= 4);
  assert.equal(it.privacy.status, STATUS.NEEDS_REVIEW);
  assert.ok(it.dataSafety.value.sdks.some((s) => s.id === 'admob'));
  const build = it.build.value.checks;
  assert.equal(build.find((x) => x.id === 'target').level, 'error', 'hedef API 34 < 35');
  const r = readiness(p);
  assert.ok(r.pct > 20 && r.pct < 80, `hazırlık %${r.pct}`);
  assert.ok(r.blockers.some((b) => b.id === 'icon'));
  assert.ok(r.blockers.some((b) => b.status === 'ERROR' && /Hedef API/.test(b.why)));
});

test('onaylı ve elle düzenlenmiş kalemler yeniden üretimde ezilmez', async () => {
  const p = createProject({ name: 'Road Haul', market: 'us-en', inputs: { repo } });
  await generatePack(p, ctx());
  editText(p, 'title', 'Road Haul: Cargo Truck');
  assert.equal(p.pack.items.title.status, STATUS.READY);
  setStatus(p, 'short', 'APPROVED');
  const shortText = p.pack.items.short.value.text;
  editText(p, 'full', 'The best FREE truck game!!');
  assert.equal(p.pack.items.full.status, STATUS.NEEDS_REVIEW);
  await generatePack(p, ctx());
  assert.equal(p.pack.items.title.value.text, 'Road Haul: Cargo Truck');
  assert.equal(p.pack.items.short.value.text, shortText);
  assert.equal(p.pack.items.short.status, STATUS.APPROVED);
  const before = readiness(p).pct;
  for (const id of Object.keys(p.pack.items)) setStatus(p, id, 'APPROVED');
  assert.ok(readiness(p).pct === 100 && before < 100);
});

test('Türkiye pazarı, fikirden proje, API yok: veri setiyle çalışır ve dürüst uyarı verir', async () => {
  const p = createProject({ name: 'Yol Kralı', market: 'tr-tr', origin: 'idea', inputs: { description: 'Tır şoförü olarak şehirler arasında yük taşıyorsun. Dorseni bağla, dağ yollarında dikkatli sür, kazandığınla garajda tırını geliştir.' } });
  await generatePack(p, { dataset: { keywords: [{ k: 'tır simülatörü', st: 'ok', demand: 60, opportunity: 55, difficulty: 45, market: 60, comp, top: ids('z'), pop: { minPrefix: 5 } }], apps: {} } });
  assert.equal(p.pack.positioning.primary.k, 'tır simülatörü');
  assert.match(p.pack.items.title.value.text, /Yol Kralı: Tır Simülatörü/);
  assert.match(p.pack.items.full.value.text, /ÖZELLİKLER/);
  assert.ok(!/offline|internetsiz/i.test(p.pack.items.full.value.text), 'çevrimdışı olgusu yok: yazılmaz');
  assert.equal(p.pack.items.privacy.value.status, 'missing');
  assert.match(p.pack.items.privacy.value.draft, /Gizlilik Politikası/);
});

test('dışa aktarım: fastlane düzeni + belgeler + project.json; içe aktarım geri yükler', async () => {
  const p = createProject({ name: 'Road Haul', market: 'us-en', inputs: { repo } });
  await generatePack(p, ctx());
  p.pack.items.icon.value = { assetId: 'a1', w: 512, h: 512 };
  const files = await exportFiles(p, async (id) => (id === 'a1' ? { bytes: new Uint8Array([137, 80, 78, 71]), type: 'image/png' } : null));
  const paths = files.map((f) => f.path);
  for (const f of ['fastlane/metadata/android/en-US/title.txt', 'fastlane/metadata/android/en-US/short_description.txt', 'fastlane/metadata/android/en-US/full_description.txt',
    'fastlane/metadata/android/en-US/changelogs/14.txt', 'fastlane/metadata/android/en-US/images/icon.png', 'publish-pack/README.md', 'publish-pack/project.json', 'publish-pack/privacy-policy.txt']) {
    assert.ok(paths.includes(f), f);
  }
  const back = importFiles(files);
  assert.equal(back.kind, 'project');
  assert.equal(back.project.id, p.id);
  assert.equal(back.project.pack.items.title.value.text, p.pack.items.title.value.text);
  const fl = importFiles(files.filter((f) => !f.path.endsWith('project.json')));
  assert.equal(fl.kind, 'fastlane');
  assert.equal(fl.project.origin, 'import');
  assert.equal(fl.project.inputs.store.title, 'Road Haul: Truck Simulator');
  assert.equal(normalizeProject({ name: 'Eski', pack: { items: { title: { status: 'GENERATING', value: null } } } }).pack.items.title.status, STATUS.MISSING);
});

test('meta veri denetimi ve başlık seçenekleri', () => {
  const a = analyzeProduct({ name: 'Road Haul', market: 'us-en', inputs: { description: 'Drive a heavy truck and deliver cargo across the country.' } });
  assert.ok(lintField('title', 'Road Haul: Offline Truck', { lang: 'en', analysis: a }).some((x) => /Doğrulanmamış iddia/.test(x.msg)));
  assert.ok(lintField('short', 'Minecraft style truck game', { lang: 'en' }).some((x) => /markanın/.test(x.msg)));
  assert.equal(lintField('title', 'Road Haul: Truck Simulator', { lang: 'en', analysis: a }).length, 0);
  const long = generateTitles('Extremely Long Brand Name Here', a, { primary: { k: 'truck simulator' }, secondary: [] });
  assert.ok(long.every((o) => o.len <= 30 || o.text === 'Extremely Long Brand Name Here'));
});

test('uyumluluk: derleme, Data Safety, gizlilik, derecelendirme', () => {
  const p = { name: 'Road Haul', inputs: { repo, build: { aab: true } } };
  const b = buildChecks(p);
  assert.equal(b.info.packageName, 'com.anatolia.roadhaul');
  assert.equal(b.checks.find((c) => c.id === 'aab').level, 'ok');
  assert.equal(buildChecks({ inputs: { build: { packageName: 'com.example.mygame', targetSdk: 36 } } }).checks.find((c) => c.id === 'package').level, 'error');
  assert.equal(buildChecks({ inputs: { build: { targetSdk: 36 } } }).checks.find((c) => c.id === 'target').level, 'ok');
  const a = analyzeProduct({ name: 'Road Haul', market: 'us-en', inputs: { repo } });
  const ds = dataSafetyDraft(p, a);
  assert.equal(ds.collects, true);
  assert.ok(ds.byType.some((t) => t.type === 'Cihaz veya diğer kimlikler' && t.shared));
  assert.equal(ds.declarations.find((d) => d.id === 'ads').answer, 'Evet');
  const pp = privacyPolicy({ ...p, inputs: { ...p.inputs, contactEmail: 'dev@example.org' } }, a, ds);
  assert.match(pp.draft, /Device or other IDs/);
  assert.match(pp.draft, /dev@example\.org/);
  assert.deepEqual(pp.missing, ['Geliştirici adı']);
  const none = dataSafetyDraft({ inputs: {} }, analyzeProduct({ name: 'X', market: 'us-en', inputs: { description: 'A calculator.' } }));
  assert.equal(none.collects, null, 'repo yok: bilinmiyor, "toplamıyor" denmez');
  const rp = ratingPrep({ name: 'Zombie Shooter', inputs: { description: 'Shoot zombies with a weapon. Blood everywhere.' } }, analyzeProduct({ name: 'Zombie Shooter', market: 'us-en', inputs: { description: 'Shoot zombies with a weapon. Blood everywhere.' } }));
  assert.ok(rp.signals.find((s) => s.id === 'violence').detected);
  assert.ok(!rp.signals.find((s) => s.id === 'gambling').detected);
});

test('ekran görüntüsü ve kısa video planları yalnızca kanıtlı özelliklerden', () => {
  const a = analyzeProduct({ name: 'Road Haul', market: 'us-en', inputs: { repo } });
  const plan = screenshotPlan({ name: 'Road Haul', inputs: {} }, a);
  assert.equal(plan.orientation, 'landscape');
  assert.ok(plan.slides.every((s) => s.caption && s.caption.length <= 36));
  assert.ok(!plan.slides.some((s) => s.concept === 'multiplayer'));
  const v = socialVideoPlans({ name: 'Road Haul', inputs: {} }, a);
  assert.deepEqual(v.map((x) => x.seconds), [6, 10, 15]);
});
