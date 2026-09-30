/*
 * Repo içe aktarma: GitHub deposundan ürünü tanımaya yarayan dosyaları seçer, çeker ve
 * ayrıştırır. Ayrıştırıcılar saf fonksiyonlardır (Node testlerinde doğrudan çalışır);
 * ağ erişimi yalnızca fetchRepo içindedir ve tarayıcıdan GitHub'a gider.
 *
 * Tanınanlar: README, AndroidManifest.xml, build.gradle(.kts), Unity ProjectSettings +
 * Packages/manifest.json, Godot project.godot + export_presets.cfg, Flutter pubspec.yaml,
 * package.json, fastlane/metadata/android/<dil>/ mağaza metinleri, betik dosya adları.
 */
import { SDKS, DEV_WORDS } from './lexicon.js';

/** "https://github.com/sahip/repo(/tree/dal)" → { owner, repo, branch } */
export function parseRepoUrl(input) {
  const s = String(input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^?#]+))?/i) || s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch: m[3] ? decodeURIComponent(m[3]) : null };
}

const SCRIPT_EXT = /\.(cs|gd|dart|kt|java|ts|tsx|js|jsx|lua|cpp|h|swift)$/i;

/** Ağaçtan çekilecek dosyaları seçer (en fazla 24). */
export function pickRepoFiles(paths) {
  const list = paths.filter((p) => !/(^|\/)(node_modules|Library|Temp|obj|build|\.git|\.gradle|Pods|\.dart_tool)\//.test(p));
  const pick = [];
  const add = (p) => { if (p && !pick.includes(p) && pick.length < 24) pick.push(p); };
  add(list.find((p) => /^readme(\.md|\.markdown|\.txt)?$/i.test(p)));
  add(list.find((p) => /^readme(\.[a-z-]+)?\.md$/i.test(p) && !pick.includes(p)));
  const manifests = list.filter((p) => /AndroidManifest\.xml$/.test(p));
  add(manifests.find((p) => /(^|\/)app\/src\/main\/AndroidManifest\.xml$/.test(p)) || manifests.find((p) => /Plugins\/Android\/AndroidManifest\.xml$/.test(p)) || manifests[0]);
  const gradles = list.filter((p) => /(^|\/)build\.gradle(\.kts)?$/.test(p));
  add(gradles.find((p) => /(^|\/)app\/build\.gradle(\.kts)?$/.test(p)) || gradles.find((p) => /launcherTemplate|mainTemplate/.test(p)));
  add(gradles.find((p) => /^build\.gradle(\.kts)?$/.test(p)));
  for (const g of list.filter((p) => /Plugins\/Android\/(mainTemplate|launcherTemplate)\.gradle$/.test(p))) add(g);
  add(list.find((p) => /(^|\/)gradle\/libs\.versions\.toml$/.test(p)));
  add(list.find((p) => /^ProjectSettings\/ProjectSettings\.asset$/.test(p)));
  add(list.find((p) => /^Packages\/manifest\.json$/.test(p)));
  add(list.find((p) => /(^|\/)project\.godot$/.test(p)));
  add(list.find((p) => /(^|\/)export_presets\.cfg$/.test(p)));
  add(list.find((p) => /^pubspec\.yaml$/.test(p)));
  add(list.find((p) => /^package\.json$/.test(p)));
  add(list.find((p) => /^app\.json$/.test(p)));
  for (const p of list.filter((x) => /fastlane\/metadata\/android\/[^/]+\/(title|short_description|full_description)\.txt$/.test(x)).slice(0, 9)) add(p);
  return pick;
}

/** Motor/çatı tespiti. */
export function detectEngine(paths) {
  const has = (re) => paths.some((p) => re.test(p));
  if (has(/^ProjectSettings\/ProjectSettings\.asset$/) || has(/^Assets\/.+\.unity$/)) return 'unity';
  if (has(/(^|\/)project\.godot$/)) return 'godot';
  if (has(/\.uproject$/)) return 'unreal';
  if (has(/^pubspec\.yaml$/)) return 'flutter';
  if (has(/(^|\/)capacitor\.config\.(json|ts)$/)) return 'capacitor';
  if (has(/^app\.json$/) && has(/^package\.json$/)) return 'react-native';
  if (has(/(^|\/)app\/src\/main\/AndroidManifest\.xml$/)) return 'android-native';
  return null;
}

/** AndroidManifest.xml → paket ve izinler. */
export function parseManifest(xml) {
  const text = String(xml || '');
  const pkg = (text.match(/<manifest[^>]*\spackage="([^"]+)"/) || [])[1] || null;
  const permissions = [...text.matchAll(/<uses-permission(?:-sdk-\d+)?[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  // tools:node="remove" ile kaldırılan izinleri çıkar
  const removed = new Set([...text.matchAll(/<uses-permission[^>]*android:name="([^"]+)"[^>]*tools:node="remove"/g)].map((m) => m[1]));
  const fgs = [...text.matchAll(/android:foregroundServiceType="([^"]+)"/g)].map((m) => m[1]);
  return { package: pkg, permissions: [...new Set(permissions.filter((p) => !removed.has(p)))], removed: [...removed], foregroundServiceTypes: fgs };
}

/** build.gradle / build.gradle.kts → kimlik, sürüm, SDK seviyeleri, bağımlılıklar. */
export function parseGradle(text) {
  const t = String(text || '');
  const val = (re) => { const m = t.match(re); return m ? m[1] : null; };
  const num = (re) => { const v = val(re); return v !== null && /^\d+$/.test(v) ? Number(v) : null; };
  const deps = [...t.matchAll(/(?:implementation|api|compileOnly|runtimeOnly|kapt|ksp)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
  // libs.versions.toml takma adları: implementation(libs.play.services.ads)
  for (const m of t.matchAll(/(?:implementation|api)\s*\(\s*libs\.([\w.]+)\s*\)/g)) deps.push(`libs:${m[1].replace(/\./g, '-')}`);
  return {
    applicationId: val(/applicationId\s*=?\s*["']([^"']+)["']/),
    namespace: val(/namespace\s*=?\s*["']([^"']+)["']/),
    versionName: val(/versionName\s*=?\s*["']([^"']+)["']/),
    versionCode: num(/versionCode\s*=?\s*(\d+)/),
    targetSdk: num(/targetSdk(?:Version)?\s*=?\s*(\d+)/),
    minSdk: num(/minSdk(?:Version)?\s*=?\s*(\d+)/),
    compileSdk: num(/compileSdk(?:Version)?\s*=?\s*(\d+)/),
    dependencies: [...new Set(deps)]
  };
}

/** Unity ProjectSettings.asset (YAML) → ürün adı, kimlik, sürüm, SDK seviyeleri. */
export function parseUnitySettings(text) {
  const t = String(text || '');
  const line = (key) => { const m = t.match(new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm')); return m ? m[1].trim() : null; };
  const appId = (t.match(/applicationIdentifier:\s*\n(?:\s+\w+:.*\n)*?\s+Android:\s*(\S+)/) || [])[1] || null;
  const target = line('AndroidTargetSdkVersion');
  const min = line('AndroidMinSdkVersion');
  return {
    productName: line('productName'),
    companyName: line('companyName'),
    bundleVersion: line('bundleVersion'),
    versionCode: /^\d+$/.test(line('AndroidBundleVersionCode') || '') ? Number(line('AndroidBundleVersionCode')) : null,
    applicationId: appId,
    // 0 = "Automatic (highest installed)"; gerçek değeri derleme makinesine bağlıdır
    targetSdk: target && /^\d+$/.test(target) && Number(target) > 0 ? Number(target) : null,
    targetSdkAuto: target === '0',
    minSdk: min && /^\d+$/.test(min) ? Number(min) : null
  };
}

/** Unity Packages/manifest.json → paket adları. */
export function parseUnityPackages(text) {
  try { return Object.keys((JSON.parse(text) || {}).dependencies || {}); } catch { return []; }
}

/** Godot project.godot → ad, açıklama. */
export function parseGodotProject(text) {
  const t = String(text || '');
  const q = (key) => { const m = t.match(new RegExp(`^${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'm')); return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : null; };
  return { name: q('config/name'), description: q('config/description'), version: q('config/version') };
}

/** Godot export_presets.cfg → Android paket adı ve sürüm. */
export function parseGodotExport(text) {
  const t = String(text || '');
  const q = (key) => { const m = t.match(new RegExp(`^${key.replace(/\//g, '\\/')}\\s*=\\s*"?([^"\\n]*)"?`, 'm')); return m ? m[1] : null; };
  const code = q('version/code');
  return { package: q('package/unique_name'), versionName: q('version/name'), versionCode: code && /^\d+$/.test(code) ? Number(code) : null, targetSdk: /^\d+$/.test(q('gradle_build/target_sdk') || '') ? Number(q('gradle_build/target_sdk')) : null };
}

/** pubspec.yaml → ad, açıklama, sürüm, bağımlılıklar (basit YAML okuma). */
export function parsePubspec(text) {
  const t = String(text || '');
  const top = (key) => { const m = t.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, 'm')); return m ? m[1].trim() : null; };
  const deps = [];
  const block = t.match(/^dependencies:\s*\n((?:[ \t]+.*\n?)*)/m);
  if (block) for (const m of block[1].matchAll(/^[ \t]{2}([a-z0-9_]+):/gm)) deps.push(m[1]);
  return { name: top('name'), description: top('description'), version: top('version'), dependencies: deps };
}

/** package.json → ad, açıklama, sürüm, bağımlılıklar. */
export function parsePackageJson(text) {
  try {
    const j = JSON.parse(text);
    return { name: j.name || null, description: j.description || null, version: j.version || null,
      dependencies: Object.keys({ ...(j.dependencies || {}), ...(j.devDependencies || {}) }) };
  } catch { return { name: null, description: null, version: null, dependencies: [] }; }
}

/** fastlane/metadata/android/<locale>/*.txt → { locale: { title, short, full } } */
export function parseFastlane(files) {
  const out = {};
  for (const [path, content] of Object.entries(files || {})) {
    const m = path.match(/fastlane\/metadata\/android\/([^/]+)\/(title|short_description|full_description)\.txt$/);
    if (!m) continue;
    const loc = m[1];
    out[loc] = out[loc] || {};
    const key = m[2] === 'title' ? 'title' : m[2] === 'short_description' ? 'short' : 'full';
    out[loc][key] = String(content || '').trim();
  }
  return out;
}

const CODE_WORDS = new Set(['awake', 'start', 'update', 'mono', 'behaviour', 'behavior', 'base', 'abstract', 'interface', 'impl',
  'factory', 'pool', 'spawner', 'spawn', 'trigger', 'collider', 'event', 'events', 'state', 'states', 'save', 'load', 'loader',
  'network', 'singleton', 'extension', 'extensions', 'editor', 'debug', 'logger', 'log', 'test', 'tests', 'mock', 'demo',
  'sample', 'example', 'main', 'app', 'game', 'scene', 'screen', 'popup', 'window', 'dialog', 'item', 'items', 'list', 'type',
  'types', 'info', 'config', 'const', 'constants', 'enum', 'helper', 'sound', 'music', 'audio', 'camera', 'input', 'touch',
  'ui', 'hud', 'text', 'label', 'image', 'sprite', 'prefab', 'asset', 'resource', 'resources', 'localization', 'ads', 'iap']);

/** Betik dosya adlarından oynanış ipuçları: "TruckController.cs" → truck, "CargoDelivery.gd" → cargo, delivery. */
export function mechanicTokensFromPaths(paths) {
  const counts = new Map();
  for (const p of paths) {
    if (!SCRIPT_EXT.test(p)) continue;
    if (!/(^|\/)(Assets|scripts?|src|lib|game)\//i.test(p)) continue;
    if (/(^|\/)(Plugins|ThirdParty|Vendor|Packages|addons|node_modules|test|tests|Editor)\//i.test(p)) continue;
    const base = p.split('/').pop().replace(SCRIPT_EXT, '');
    const words = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_\-.]+/);
    for (const w of words) {
      const t = w.toLowerCase();
      if (t.length < 3 || /^\d+$/.test(t) || DEV_WORDS.has(t) || CODE_WORDS.has(t)) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30).map(([t]) => t);
}

/** SDK tespiti: bağımlılık listeleri + dosya yolları (Unity eklenti klasörleri güçlü sinyaldir). */
export function detectSdks(haystacks) {
  const text = haystacks.filter(Boolean).join('\n');
  return SDKS.filter((s) => s.pattern.test(text)).map((s) => s.id);
}

/**
 * Çekilen dosyalardan repo özeti.
 * @param {{[path:string]: string}} files
 * @param {string[]} paths ağaçtaki tüm yollar
 */
export function summarizeRepo(files, paths = [], info = {}) {
  const get = (re) => { const k = Object.keys(files).find((p) => re.test(p)); return k ? files[k] : null; };
  const readmeKey = Object.keys(files).find((p) => /^readme/i.test(p));
  const manifestText = get(/AndroidManifest\.xml$/);
  const manifest = manifestText ? parseManifest(manifestText) : null;
  const gradleTexts = Object.entries(files).filter(([p]) => /\.gradle(\.kts)?$|libs\.versions\.toml$/.test(p)).map(([, t]) => t);
  const gradle = gradleTexts.length ? parseGradle(gradleTexts.join('\n')) : null;
  const unitySettings = get(/ProjectSettings\.asset$/) ? parseUnitySettings(get(/ProjectSettings\.asset$/)) : null;
  const unityPackages = get(/^Packages\/manifest\.json$/) ? parseUnityPackages(get(/^Packages\/manifest\.json$/)) : [];
  const godot = get(/project\.godot$/) ? parseGodotProject(get(/project\.godot$/)) : null;
  const godotExport = get(/export_presets\.cfg$/) ? parseGodotExport(get(/export_presets\.cfg$/)) : null;
  const pubspec = get(/^pubspec\.yaml$/) ? parsePubspec(get(/^pubspec\.yaml$/)) : null;
  const pkg = get(/^package\.json$/) ? parsePackageJson(get(/^package\.json$/)) : null;
  const fastlane = parseFastlane(files);
  const engine = detectEngine(paths.length ? paths : Object.keys(files));
  const sdks = detectSdks([
    gradle && gradle.dependencies.join('\n'), unityPackages.join('\n'),
    pubspec && pubspec.dependencies.join('\n'), pkg && pkg.dependencies.join('\n'),
    paths.filter((p) => /(Plugins|addons|Assets)\//.test(p)).join('\n'),
    manifestText
  ]);
  const permissions = manifest ? manifest.permissions : [];
  const first = (...xs) => xs.find((x) => x !== null && x !== undefined && x !== '') ?? null;
  return {
    scanned: true,
    source: info.url || null,
    branch: info.branch || null,
    engine,
    name: first(unitySettings && unitySettings.productName, godot && godot.name, pubspec && pubspec.name, pkg && pkg.name, info.repo),
    description: first(godot && godot.description, pubspec && pubspec.description, pkg && pkg.description, info.description),
    readme: readmeKey ? files[readmeKey] : '',
    readmePath: readmeKey || null,
    packageName: first(gradle && gradle.applicationId, unitySettings && unitySettings.applicationId, godotExport && godotExport.package, manifest && manifest.package, gradle && gradle.namespace),
    versionName: first(gradle && gradle.versionName, unitySettings && unitySettings.bundleVersion, godotExport && godotExport.versionName, pubspec && pubspec.version && pubspec.version.split('+')[0], pkg && pkg.version),
    versionCode: first(gradle && gradle.versionCode, unitySettings && unitySettings.versionCode, godotExport && godotExport.versionCode, pubspec && pubspec.version && /\+(\d+)$/.test(pubspec.version) ? Number(pubspec.version.split('+')[1]) : null),
    targetSdk: first(gradle && gradle.targetSdk, unitySettings && unitySettings.targetSdk, godotExport && godotExport.targetSdk),
    targetSdkAuto: !!(unitySettings && unitySettings.targetSdkAuto),
    minSdk: first(gradle && gradle.minSdk, unitySettings && unitySettings.minSdk),
    manifestFound: !!manifest,
    permissions,
    foregroundServiceTypes: manifest ? manifest.foregroundServiceTypes : [],
    sdks,
    fastlane,
    mechanicTokens: mechanicTokensFromPaths(paths),
    fileCount: paths.length,
    fetched: Object.keys(files)
  };
}

/**
 * GitHub'dan repo çeker (tarayıcıda). Genel repolar için anahtar gerekmez; özel repo için
 * kullanıcının kişisel erişim anahtarı yalnızca api.github.com'a gönderilir.
 */
export async function fetchRepo(url, opts = {}) {
  const { token = null, fetchImpl = globalThis.fetch.bind(globalThis), onProgress = () => {} } = opts;
  const ref = parseRepoUrl(url);
  if (!ref) throw new Error('GitHub adresi anlaşılamadı. Örnek: https://github.com/kullanici/oyun');
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const api = async (path) => {
    const r = await fetchImpl(`https://api.github.com${path}`, { headers });
    if (r.status === 404) throw new Error('Repo bulunamadı ya da özel (özel repo için erişim anahtarı gerekir).');
    if (r.status === 403 || r.status === 429) throw new Error('GitHub istek sınırına takıldı; biraz sonra tekrar dene ya da erişim anahtarı gir.');
    if (!r.ok) throw new Error(`GitHub hatası: HTTP ${r.status}`);
    return r.json();
  };
  onProgress('Repo bilgisi alınıyor…');
  const info = await api(`/repos/${ref.owner}/${ref.repo}`);
  const branch = ref.branch || info.default_branch || 'main';
  onProgress('Dosya ağacı alınıyor…');
  const tree = await api(`/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const paths = (tree.tree || []).filter((n) => n.type === 'blob').map((n) => n.path);
  const pick = pickRepoFiles(paths);
  const files = {};
  let i = 0;
  for (const p of pick) {
    onProgress(`Dosyalar okunuyor (${++i}/${pick.length}): ${p}`);
    let text = null;
    if (token) {
      const r = await fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
        { headers: { ...headers, Accept: 'application/vnd.github.raw' } });
      if (r.ok) text = await r.text();
    } else {
      const r = await fetchImpl(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(branch)}/${p.split('/').map(encodeURIComponent).join('/')}`);
      if (r.ok) text = await r.text();
    }
    if (text !== null) files[p] = text.slice(0, 200_000);
  }
  return summarizeRepo(files, paths, {
    url: `https://github.com/${ref.owner}/${ref.repo}`, branch, repo: info.name, description: info.description,
    truncated: !!tree.truncated
  });
}
