import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProduct, keywordRelevance, detectLang, extractFeatureLines, scanText, classifyGenre } from '../public/js/pack/product.js';
import {
  summarizeRepo, parseRepoUrl, parseGradle, parseManifest, parseGodotProject, parseGodotExport, parsePubspec,
  parseFastlane, pickRepoFiles, mechanicTokensFromPaths, parseUnitySettings
} from '../public/js/pack/repo.js';
import { TRUCK_FILES, TRUCK_PATHS } from './fixtures/truck-repo.js';

const repo = summarizeRepo(TRUCK_FILES, TRUCK_PATHS, { url: 'https://github.com/anatolia/road-haul', repo: 'road-haul' });
const project = (market, extra = {}) => ({ name: 'Road Haul', market, inputs: { repo, ...extra } });

test('repo özeti: Unity, paket adı, sürüm, SDK, izinler, betik ipuçları', () => {
  assert.equal(repo.engine, 'unity');
  assert.equal(repo.name, 'Road Haul');
  assert.equal(repo.packageName, 'com.anatolia.roadhaul');
  assert.equal(repo.versionName, '1.4.0');
  assert.equal(repo.versionCode, 14);
  assert.equal(repo.targetSdk, 34);
  assert.equal(repo.minSdk, 24);
  assert.ok(repo.sdks.includes('admob'), 'GoogleMobileAds klasörü AdMob sayılmalı');
  assert.ok(repo.sdks.includes('unity_ads'));
  assert.ok(!repo.sdks.includes('billing'), 'satın alma yok');
  assert.ok(repo.permissions.includes('com.google.android.gms.permission.AD_ID'));
  assert.ok(!repo.permissions.includes('android.permission.READ_PHONE_STATE'), 'tools:node=remove edilen izin sayılmaz');
  for (const t of ['truck', 'cargo', 'trailer', 'garage', 'weather']) assert.ok(repo.mechanicTokens.includes(t), t);
  for (const t of ['controller', 'manager', 'ui', 'ads']) assert.ok(!repo.mechanicTokens.includes(t), `${t} gürültüdür`);
});

test('Global pazar: tür, olgular, gerçek özellikler, tohumlar', () => {
  const a = analyzeProduct(project('us-en'));
  assert.equal(a.lang, 'en');
  assert.equal(a.genre.id, 'truck_sim');
  assert.ok(a.genre.confidence >= 0.6, `güven ${a.genre.confidence}`);
  assert.equal(a.facts.offline.value, true);
  assert.equal(a.facts.ads.value, true);
  assert.equal(a.facts.iap.value, false);
  assert.equal(a.facts.adId.value, true);
  const texts = a.features.map((f) => f.text);
  assert.ok(texts.includes('Hitch and haul heavy trailers'), texts.join(' | '));
  assert.ok(texts.includes('Works offline, no internet required'));
  assert.ok(!texts.some((t) => /Unity|Build for Android|Documentation/.test(t)), 'kurulum satırları özellik değildir');
  const seeds = a.seeds.map((s) => s.k);
  assert.ok(seeds.includes('truck simulator'));
  assert.ok(seeds.includes('cargo truck'));
  assert.ok(seeds.length <= 14);
  // README'deki gürültü yanlış kavram üretmemeli
  assert.ok(!a.concepts.shooter, '"60 fps" nişancı sayılmamalı');
  assert.ok(!a.concepts.habit, '"release notes" not uygulaması sayılmamalı');
});

test('Türkiye pazarı, İngilizce README: kavramlar dil ötesi eşleşir, özellikler Türkçe üretilir', () => {
  const a = analyzeProduct(project('tr-tr'));
  assert.equal(a.lang, 'tr');
  assert.equal(a.genre.id, 'truck_sim');
  const texts = a.features.map((f) => f.text);
  assert.ok(texts.includes('Dorse bağlama ve ağır yük taşıma'), texts.join(' | '));
  assert.ok(texts.includes('İnternetsiz oynanabilir'));
  assert.ok(!texts.some((t) => /Hitch and haul/.test(t)), 'yanlış dildeki satır Türkçe listeye girmez');
  assert.ok(a.seeds.map((s) => s.k).includes('tır simülatörü'));
  assert.equal(keywordRelevance('tır oyunları', a).score, 1);
  assert.equal(keywordRelevance('internetsiz tır oyunu', a).score, 1);
  const bus = keywordRelevance('otobüs simülatörü', a);
  assert.ok(bus.score <= 0.5, 'yarısı (simülatör) türden, otobüs karşılıksız');
  // İngilizce proje adı Türkçe pazarda tohum olmaz; türetilmiş öbekler aday değil ön ektir
  assert.ok(!a.seeds.some((s) => s.k === 'road haul'));
  assert.ok(a.seeds.filter((s) => s.sources.includes('concept')).every((s) => s.role === 'prefix'));
  assert.ok(a.seeds.filter((s) => s.sources.includes('genre')).every((s) => s.role === 'candidate'));
});

test('ürünle uyum: tür ima eder, yıl ve marka reddedilir', () => {
  const a = analyzeProduct(project('us-en'));
  assert.equal(keywordRelevance('truck simulator', a).score, 1, 'simulator türün kendisi');
  assert.equal(keywordRelevance('offline truck game', a).score, 1);
  const y = keywordRelevance('truck simulator 2024', a);
  assert.ok(y.score < 1 && y.reasons.some((r) => r.includes('yıl')));
  const t = keywordRelevance('euro truck simulator', a);
  assert.equal(t.trademark, 'euro truck simulator');
  assert.ok(t.reasons[0].startsWith('marka adı'));
});

test('dürüstlük: kanıtsız iddia birincil olamaz, kullanıcı reddi her şeyi ezer', () => {
  const plain = { name: 'Road Haul', market: 'us-en', inputs: { description: 'Drive a heavy truck and deliver cargo across the country.' } };
  const a = analyzeProduct(plain);
  assert.equal(a.facts.offline.value, null);
  const r = keywordRelevance('offline truck game', a);
  assert.deepEqual(r.unsupportedClaims, ['offline']);
  assert.ok(r.score < 1);
  const denied = analyzeProduct(project('us-en', { facts: { offline: false } }));
  assert.equal(denied.facts.offline.value, false);
  assert.deepEqual(keywordRelevance('offline truck game', denied).unsupportedClaims, ['offline']);
  assert.ok(!denied.features.some((f) => f.concept === 'offline'), 'reddedilen iddia özellik listesine girmez');
});

test('fikirden proje (Türkçe açıklama) ve uygulama türleri', () => {
  const idea = analyzeProduct({ name: 'Yol Kralı', market: 'tr-tr', inputs: { description: 'Tır şoförü olarak şehirler arasında yük taşıyorsun. Dorseni bağla, dağ yollarında dikkatli sür, kazandığınla garajda tırını geliştir.' } });
  assert.equal(detectLang('Tır şoförü olarak şehirler arasında yük taşıyorsun.'), 'tr');
  assert.equal(idea.genre.id, 'truck_sim');
  const calc = analyzeProduct({ name: 'Quick KDV', market: 'tr-tr', inputs: { description: 'KDV hesaplama, kredi faizi ve maaş hesaplama için sade bir araç.' } });
  assert.ok(['app_finance', 'app_calculator'].includes(calc.genre.id), calc.genre.id);
  assert.equal(calc.genre.game, false);
  const puzzle = analyzeProduct({ name: 'Water Flow', market: 'us-en', inputs: { description: 'A relaxing water sort puzzle game. Sort colors into tubes and clear hundreds of levels.' } });
  assert.equal(puzzle.genre.id, 'puzzle');
});

test('kullanıcının seçtiği tür her zaman kazanır', () => {
  const g = classifyGenre({}, 0, { genreId: 'bus_sim' });
  assert.equal(g.id, 'bus_sim');
  assert.equal(g.source, 'user');
});

test('ayrıştırıcılar: gradle (groovy/kts), manifest, godot, pubspec, fastlane, repo adresi', () => {
  const kts = parseGradle(`android { namespace = "com.x.app"\n defaultConfig { applicationId = "com.x.app"\n minSdk = 24\n targetSdk = 35\n versionCode = 7\n versionName = "2.1" } }\ndependencies { implementation("com.google.android.gms:play-services-ads:23.0.0")\n implementation(libs.billing.ktx) }`);
  assert.equal(kts.applicationId, 'com.x.app');
  assert.equal(kts.targetSdk, 35);
  assert.equal(kts.versionCode, 7);
  assert.ok(kts.dependencies.includes('com.google.android.gms:play-services-ads:23.0.0'));
  const groovy = parseGradle(`defaultConfig {\n applicationId "com.y.game"\n minSdkVersion 21\n targetSdkVersion 33\n versionCode 3\n versionName "1.0.2"\n}\ndependencies { implementation 'com.android.billingclient:billing:6.0.1' }`);
  assert.equal(groovy.applicationId, 'com.y.game');
  assert.equal(groovy.targetSdk, 33);
  assert.equal(groovy.minSdk, 21);
  const m = parseManifest('<manifest package="a.b"><uses-permission android:name="android.permission.CAMERA"/><uses-permission android:name="android.permission.INTERNET" tools:node="remove"/></manifest>');
  assert.deepEqual(m.permissions, ['android.permission.CAMERA']);
  const gd = parseGodotProject('[application]\nconfig/name="Cargo Rush"\nconfig/description="Deliver cargo fast"\n');
  assert.equal(gd.name, 'Cargo Rush');
  assert.equal(parseGodotExport('package/unique_name="com.c.rush"\nversion/code=5\nversion/name="1.2"').package, 'com.c.rush');
  const ps = parsePubspec('name: calc_pro\ndescription: "A calculator"\nversion: 1.2.0+9\ndependencies:\n  flutter:\n    sdk: flutter\n  google_mobile_ads: ^5.0.0\n  in_app_purchase: ^3.1.0\n');
  assert.deepEqual(ps.dependencies, ['flutter', 'google_mobile_ads', 'in_app_purchase']);
  const fl = parseFastlane({ 'fastlane/metadata/android/tr-TR/title.txt': 'Yol Kralı\n', 'fastlane/metadata/android/tr-TR/short_description.txt': 'Tır sür' });
  assert.deepEqual(fl, { 'tr-TR': { title: 'Yol Kralı', short: 'Tır sür' } });
  assert.deepEqual(parseRepoUrl('https://github.com/a-b/c.d/tree/dev'), { owner: 'a-b', repo: 'c.d', branch: 'dev' });
  assert.deepEqual(parseRepoUrl('a/b'), { owner: 'a', repo: 'b', branch: null });
  assert.equal(parseRepoUrl('https://gitlab.com/a/b'), null);
  assert.equal(parseUnitySettings('AndroidTargetSdkVersion: 0').targetSdkAuto, true);
});

test('dosya seçimi ve betik adları', () => {
  const pick = pickRepoFiles(TRUCK_PATHS);
  assert.ok(pick.includes('README.md'));
  assert.ok(pick.includes('Assets/Plugins/Android/AndroidManifest.xml'));
  assert.ok(!pick.some((p) => p.startsWith('Library/')));
  assert.deepEqual(mechanicTokensFromPaths(['Assets/Scripts/FuelGauge.cs', 'Assets/Editor/BuildTool.cs']), ['fuel', 'gauge']);
});

test('özellik satırları: başlık altındaki liste, kurulum satırları hariç', () => {
  const lines = extractFeatureLines('# X\n## Özellikler\n- Dağ yollarında sürüş\n- Kurulum için Unity aç\n## Kurulum\n- npm install\n');
  assert.deepEqual(lines, ['Dağ yollarında sürüş', 'Kurulum için Unity aç'].filter((l) => !/^Kurulum/.test(l)));
  assert.ok(scanText('Unity 2022 release notes, 60 fps', { devFilter: true }).concepts.size === 0);
});
