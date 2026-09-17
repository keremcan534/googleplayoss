#!/usr/bin/env node
/*
 * "Derleme" adımı: bu proje statik olduğu için paketleme yok; onun yerine
 * yayına çıkacak her şeyi doğrularız. Vercel ve CI bu betiği çalıştırır.
 *  - tüm JS dosyaları sözdizimi kontrolünden geçer
 *  - config ve veri JSON'ları geçerli mi
 *  - public/ içinde gerekli dosyalar var mı, index.html modülleri doğru mu
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const ok = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p);

// 1) JS sözdizimi
const jsFiles = files.filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    errors.push(`JS sözdizimi: ${rel(f)}\n${String(err.stderr || err.message).trim()}`);
  }
}
ok.push(`${jsFiles.length} JS dosyası sözdizimi kontrolünden geçti`);

// 2) JSON geçerliliği
const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.includes('package-lock.json'));
for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    errors.push(`Geçersiz JSON: ${rel(f)} — ${err.message}`);
  }
}
ok.push(`${jsonFiles.length} JSON dosyası ayrıştırıldı`);

// 3) yayın dosyaları
const required = ['public/index.html', 'public/app.js', 'public/style.css', 'public/js/verdict.js', 'vercel.json'];
for (const r of required) {
  if (!fs.existsSync(path.join(ROOT, r))) errors.push(`Eksik dosya: ${r}`);
}
ok.push(`${required.length} zorunlu yayın dosyası yerinde`);

// 4) index.html referansları
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
if (!/<script[^>]+type="module"[^>]+src="\.\/app\.js"/.test(html)) errors.push('index.html app.js modülünü yüklemiyor (type="module" gerekli).');
for (const m of html.matchAll(/(?:href|src)="\.\/([^"#?]+)"/g)) {
  const target = path.join(ROOT, 'public', m[1]);
  if (!fs.existsSync(target)) errors.push(`index.html eksik dosyaya işaret ediyor: public/${m[1]}`);
}
ok.push('index.html referansları çözümlendi');

// 5) veri dosyaları varsa beklenen şekilde mi (veri yoksa hata değil)
const dataDir = path.join(ROOT, 'public/data');
if (fs.existsSync(path.join(dataDir, 'index.json'))) {
  const idx = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.json'), 'utf8'));
  if (!Array.isArray(idx.markets)) errors.push('public/data/index.json içinde markets dizisi yok.');
  else {
    for (const m of idx.markets) {
      const f = path.join(dataDir, `${m.id}.json`);
      if (!fs.existsSync(f)) { errors.push(`Pazar dosyası eksik: public/data/${m.id}.json`); continue; }
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!Array.isArray(d.keywords)) errors.push(`public/data/${m.id}.json içinde keywords dizisi yok.`);
      if (!Array.isArray(d.niches)) errors.push(`public/data/${m.id}.json içinde niches dizisi yok.`);
    }
    ok.push(`${idx.markets.length} pazar veri dosyası doğrulandı`);
  }
} else {
  ok.push('Veri dosyası yok (ilk tarama henüz çalışmamış) — yayın için sorun değil');
}

for (const line of ok) console.log(`✓ ${line}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} sorun:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('\nDerleme kontrolü tamam.');
