/*
 * Yayın uyumluluğu: gizlilik politikası, Data Safety taslağı, içerik derecelendirme hazırlığı,
 * derleme (AAB / hedef API / paket adı) kontrolleri.
 *
 * Bu modül hukuki tavsiye vermez; repodan ve beyanlardan çıkarılabilen gerçekleri listeler,
 * bilinmeyenleri soru olarak bırakır. SDK veri türleri sağlayıcı rehberlerindeki tipik
 * kalemlerdir; nihai beyan sağlayıcının güncel belgesiyle doğrulanmalıdır.
 */
import { SDKS, PERMISSIONS, RATING_SIGNALS, TARGET_SDK } from './lexicon.js';
import { normalizeFor } from '../lang.js';

const PLACEHOLDER_PACKAGES = /^(com\.(example|defaultcompany|company|unity3d\.player|mycompany|yourcompany)\b|com\.unity\.template|org\.godotengine\.)/i;

/* ---------------- derleme ---------------- */

/**
 * @returns {{info:object, checks:Array<{id, level:'ok'|'warn'|'error'|'todo', msg}>}}
 */
export function buildChecks(project) {
  const i = (project && project.inputs) || {};
  const repo = i.repo || {};
  const b = i.build || {};
  const info = {
    packageName: b.packageName || repo.packageName || null,
    versionName: b.versionName || repo.versionName || null,
    versionCode: b.versionCode ?? repo.versionCode ?? null,
    targetSdk: b.targetSdk ?? repo.targetSdk ?? null,
    targetSdkAuto: !b.targetSdk && !!repo.targetSdkAuto,
    minSdk: b.minSdk ?? repo.minSdk ?? null,
    engine: repo.engine || null
  };
  const checks = [];
  const add = (id, level, msg) => checks.push({ id, level, msg });

  if (!info.packageName) add('package', 'todo', 'Paket adı (applicationId) bilinmiyor. Yayından sonra değiştirilemez; şimdi belirle.');
  else if (PLACEHOLDER_PACKAGES.test(info.packageName)) add('package', 'error', `Paket adı şablon görünüyor (${info.packageName}). Yayından sonra değiştirilemez; kendi alan adınla değiştir.`);
  else add('package', 'ok', `Paket adı: ${info.packageName}`);

  if (info.targetSdkAuto) add('target', 'warn', `Unity "otomatik (en yüksek yüklü)" hedef API kullanıyor. Derleme makinende en az API ${TARGET_SDK.min} yüklü olduğunu doğrula.`);
  else if (!Number.isFinite(info.targetSdk)) add('target', 'todo', `Hedef API bilinmiyor. Play yeni uygulamalar için en az API ${TARGET_SDK.min} istiyor (${TARGET_SDK.asOf} itibarıyla doğrulanmış eşik).`);
  else if (info.targetSdk < TARGET_SDK.min) add('target', 'error', `Hedef API ${info.targetSdk}: Play en az ${TARGET_SDK.min} istiyor (${TARGET_SDK.asOf} itibarıyla). Bu derleme yüklenemez.`);
  else if (info.targetSdk < TARGET_SDK.likelyNext) add('target', 'warn', `Hedef API ${info.targetSdk}. Google eşiği her yıl Ağustos sonunda bir seviye yükseltir; 2026 eşiği büyük olasılıkla ${TARGET_SDK.likelyNext}. Play Console'daki güncel şartı doğrula.`);
  else add('target', 'ok', `Hedef API ${info.targetSdk}.`);

  if (!Number.isFinite(info.versionCode)) add('versionCode', 'todo', 'versionCode bilinmiyor. Her yüklemede bir öncekinden büyük olmalı.');
  else add('versionCode', 'ok', `versionCode ${info.versionCode}${info.versionName ? ` · versionName ${info.versionName}` : ''}`);

  add('aab', b.aab ? 'ok' : 'todo', b.aab ? 'Android App Bundle (.aab) hazır.' : 'Yeni uygulamalar .aab olarak yüklenir (APK kabul edilmez). Release derlemesini AAB olarak al.');
  add('signing', b.signed ? 'ok' : 'todo', b.signed ? 'Yükleme anahtarıyla imzalandı.' : 'AAB yükleme anahtarıyla imzalanmalı; Play App Signing uygulama imzasını Google tarafında tutar. Anahtar deposunu (keystore) yedekle.');
  add('testing', b.testingDone ? 'ok' : 'todo', b.testingDone
    ? 'Kapalı test şartı tamamlandı.'
    : '13 Kasım 2023 sonrası açılan kişisel geliştirici hesaplarında üretime çıkmadan önce kapalı testte en az 12 test kullanıcısı 14 gün boyunca kesintisiz katılmış olmalı. Kuruluş hesaplarında bu şart yok.');
  if (repo.foregroundServiceTypes && repo.foregroundServiceTypes.length) add('fgs', 'warn', `Ön plan hizmeti türleri (${repo.foregroundServiceTypes.join(', ')}) Play Console'da beyan edilmeli.`);
  return { info, checks };
}

/* ---------------- Data Safety ---------------- */

/**
 * @returns {{collects:boolean|null, byType:Array<{type, sdks:string[], shared:boolean}>, sdks:Array, permissions:Array,
 *   declarations:Array<{id, answer, basis}>, questions:string[], confidence:string}}
 */
export function dataSafetyDraft(project, analysis) {
  const i = (project && project.inputs) || {};
  const repo = i.repo || {};
  const scanned = !!repo.scanned;
  const found = SDKS.filter((s) => (repo.sdks || []).includes(s.id));
  const manual = (i.sdksManual || []).map((id) => SDKS.find((s) => s.id === id)).filter(Boolean);
  const sdks = [...new Map([...found, ...manual].map((s) => [s.id, s])).values()];
  const perms = (repo.permissions || []).map((p) => ({ perm: p, ...(PERMISSIONS[p] || { data: null, note: '' }) }));
  const byType = new Map();
  const addType = (type, who, shared) => {
    const e = byType.get(type) || { type, sdks: [], shared: false };
    if (!e.sdks.includes(who)) e.sdks.push(who);
    e.shared = e.shared || !!shared;
    byType.set(type, e);
  };
  for (const s of sdks) for (const d of s.data) addType(d, s.label, s.shared);
  for (const p of perms) if (p.data) addType(p.data, p.perm.replace(/^.*\./, ''), false);
  if (analysis && analysis.facts && analysis.facts.account && analysis.facts.account.value === true) {
    addType('E-posta adresi', 'Hesap sistemi', false);
    addType('Kullanıcı kimlikleri', 'Hesap sistemi', false);
  }
  const collects = byType.size ? true : scanned ? false : null;
  const f = (analysis && analysis.facts) || {};
  const declarations = [
    { id: 'ads', q: 'Uygulamanızda reklam var mı?', answer: f.ads ? yesNo(f.ads.value) : 'Bilinmiyor', basis: f.ads ? f.ads.note : '' },
    { id: 'adId', q: 'Reklam kimliği (AD_ID) kullanılıyor mu?', answer: f.adId ? yesNo(f.adId.value) : 'Bilinmiyor', basis: f.adId ? f.adId.note : '' },
    { id: 'account', q: 'Kullanıcı hesap oluşturabiliyor mu? (Evet ise uygulama içi ve web üzerinden hesap silme yolu zorunlu)', answer: f.account ? yesNo(f.account.value) : 'Bilinmiyor', basis: f.account ? f.account.note : '' },
    { id: 'kids', q: 'Hedef kitlede 13 yaş altı çocuklar var mı? (Evet ise Aileler politikası ve sertifikalı reklam SDK\'ları)', answer: f.kids && f.kids.value === true ? 'Muhtemelen evet' : 'Belirt', basis: f.kids ? f.kids.note : '' }
  ];
  const questions = [];
  if (collects) {
    questions.push('Toplanan veriler aktarım sırasında şifreleniyor mu? (HTTPS kullanan SDK\'larda genellikle evet — doğrula)');
    questions.push('Kullanıcılar verilerinin silinmesini isteyebiliyor mu? Nasıl?');
    questions.push('Veri toplama isteğe bağlı mı, zorunlu mu? (Reklam/analiz SDK\'ları genellikle zorunlu toplar)');
  }
  if (!scanned) questions.push('Repo taranmadı: kullandığın reklam, analiz, satın alma ve giriş SDK\'larını elle işaretle.');
  if (scanned && !repo.manifestFound) questions.push('AndroidManifest bulunamadı: son derlemedeki birleşik manifest farklı izinler içerebilir (SDK\'lar izin ekler).');
  const restricted = perms.filter((p) => p.restricted);
  for (const p of restricted) questions.push(`${p.perm}: ${p.note}`);
  return { collects, byType: [...byType.values()], sdks: sdks.map((s) => ({ id: s.id, label: s.label, data: s.data, purposes: s.purposes, shared: s.shared })),
    permissions: perms, declarations, questions, confidence: scanned ? (repo.manifestFound ? 'repo + manifest' : 'repo') : 'beyan' };
}

function yesNo(v) { return v === true ? 'Evet' : v === false ? 'Hayır' : 'Bilinmiyor'; }

/* ---------------- gizlilik politikası ---------------- */

/**
 * Tüm Play uygulamaları gizlilik politikası bağlantısı vermek zorundadır.
 * @returns {{required:true, status:'provided'|'missing', url:string|null, draft:string, missing:string[]}}
 */
export function privacyPolicy(project, analysis, ds) {
  const i = (project && project.inputs) || {};
  const url = i.privacyUrl && /^https:\/\//.test(i.privacyUrl) ? i.privacyUrl : null;
  const lang = analysis ? analysis.lang : 'en';
  const name = project.name || 'App';
  const dev = i.developerName || null;
  const email = i.contactEmail || null;
  const missing = [];
  if (!dev) missing.push('Geliştirici adı');
  if (!email) missing.push('İletişim e-postası');
  const d = ds || dataSafetyDraft(project, analysis);
  const today = new Date().toISOString().slice(0, 10);
  const who = dev || (lang === 'tr' ? '(geliştirici adı)' : '(developer name)');
  const mail = email || (lang === 'tr' ? '(iletişim e-postası)' : '(contact email)');
  let draft;
  if (lang === 'tr') {
    draft = [
      `${name} Gizlilik Politikası`, `Son güncelleme: ${today}`, '',
      `Bu politika ${who} tarafından geliştirilen ${name} uygulamasının hangi verileri nasıl işlediğini açıklar.`, '',
      'Toplanan veriler',
      ...(d.collects ? d.byType.map((t) => `• ${t.type} — ${t.sdks.join(', ')}${t.shared ? ' (üçüncü tarafla paylaşılır)' : ''}`) : ['• Uygulama kişisel veri toplamaz.']),
      '',
      ...(d.sdks.length ? ['Üçüncü taraf hizmetler', ...d.sdks.map((s) => `• ${s.label}: ${s.purposes}`), 'Bu hizmetlerin kendi gizlilik politikaları geçerlidir.', ''] : []),
      'Veri silme', `Verilerinin silinmesini istemek için ${mail} adresine yaz.`, '',
      'Çocuklar', 'Uygulama bilerek 13 yaş altı çocuklardan kişisel veri toplamaz.', '',
      'İletişim', mail
    ].join('\n');
  } else {
    draft = [
      `${name} Privacy Policy`, `Last updated: ${today}`, '',
      `This policy explains what data ${name}, developed by ${who}, processes and how.`, '',
      'Data we collect',
      ...(d.collects ? d.byType.map((t) => `• ${t.type} — ${t.sdks.join(', ')}${t.shared ? ' (shared with a third party)' : ''}`) : ['• The app does not collect personal data.']),
      '',
      ...(d.sdks.length ? ['Third-party services', ...d.sdks.map((s) => `• ${s.label}: ${s.purposes}`), 'Their own privacy policies apply.', ''] : []),
      'Data deletion', `To request deletion of your data, email ${mail}.`, '',
      'Children', 'The app does not knowingly collect personal data from children under 13.', '',
      'Contact', mail
    ].join('\n');
    // veri türü adları sözlükte Türkçe; İngilizce taslakta karşılıklarını kullan
    draft = draft.replace(/Cihaz veya diğer kimlikler/g, 'Device or other IDs').replace(/Uygulama etkileşimleri/g, 'App interactions')
      .replace(/Tanılama/g, 'Diagnostics').replace(/Yaklaşık konum \(IP\)|Yaklaşık konum/g, 'Approximate location').replace(/Kilitlenme günlükleri/g, 'Crash logs')
      .replace(/E-posta adresi/g, 'Email address').replace(/Kullanıcı kimlikleri/g, 'User IDs').replace(/Hassas konum/g, 'Precise location')
      .replace(/Fotoğraflar ve videolar/g, 'Photos and videos').replace(/Ses kayıtları/g, 'Audio recordings').replace(/Reklam, analiz, dolandırıcılık önleme/g, 'Advertising, analytics, fraud prevention')
      .replace(/Reklam, analiz/g, 'Advertising, analytics').replace(/Uygulama işlevselliği, analiz/g, 'App functionality, analytics').replace(/Analiz, reklam ölçümü/g, 'Analytics, ad measurement')
      .replace(/Uygulama işlevselliği/g, 'App functionality').replace(/Hesap yönetimi/g, 'Account management').replace(/\bAnaliz\b/g, 'Analytics').replace(/\bReklam\b/g, 'Advertising')
      .replace(/Hesap sistemi/g, 'Account system');
  }
  return { required: true, status: url ? 'provided' : 'missing', url, draft, missing };
}

/* ---------------- içerik derecelendirme ---------------- */

export function ratingPrep(project, analysis) {
  const lang = analysis ? analysis.lang : 'en';
  const i = (project && project.inputs) || {};
  const texts = [project.name, i.description, i.mechanics, i.screenNotes, i.readme, i.repo && i.repo.readme, i.store && i.store.full]
    .filter(Boolean).map((t) => ` ${normalizeFor(t, 'en')} ${normalizeFor(t, 'tr')} `).join(' ');
  const answers = i.rating || {};
  const signals = RATING_SIGNALS.map((s) => {
    const byConcept = s.concepts.filter((c) => analysis && analysis.concepts && analysis.concepts[c]);
    const byWord = s.words.filter((w) => texts.includes(` ${normalizeFor(w, lang === 'tr' ? 'tr' : 'en')} `));
    const detected = byConcept.length > 0 || byWord.length > 0;
    return { id: s.id, label: s.label, question: s.question, detected, evidence: [...byConcept, ...byWord], answer: answers[s.id] ?? null };
  });
  const unanswered = signals.filter((s) => s.answer === null);
  return { signals, unanswered: unanswered.length, note: 'İçerik derecelendirmesi Play Console\'daki IARC anketiyle alınır; burada yalnızca yanıtlarını hazırlıyorsun.' };
}
