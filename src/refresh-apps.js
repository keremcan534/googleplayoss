#!/usr/bin/env node
/*
 * Eksik alanları olan uygulama kayıtlarını yeniler.
 *
 * Neden: Play Store yayın tarihi yerelleştirilmiş gelir ("15 Kas 2012"). Türkçe
 * biçim ayrıştırılamadığı için önbellekteki kayıtların çoğunda released=null
 * kaldı ve "son 2 yılda ilk 10'a girenler" ölçüsü kör kaldı. Tarih ayrıştırıcı
 * düzeltildikten sonra bu betik yalnızca eksik kayıtları yeniden çeker;
 * normal tarama önbellek ömrü (appTtlDays) dolmadan onlara dokunmaz.
 *
 * Kullanım: npm run refresh-apps -- --market tr-tr [--limit 3000] [--field released]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { stringifyLines } from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, stringifyLines(obj));
  fs.renameSync(tmp, p);
}

async function refresh(marketId, opts = {}) {
  const { field = 'released', limit = 5000, throttleMs = 300, concurrency = 3 } = opts;
  const [country, lang] = marketId.split('-');
  const appsPath = path.join(ROOT, 'data', marketId, 'apps.json');
  const apps = readJson(appsPath);
  if (!apps) throw new Error(`Önbellek yok: ${appsPath}`);
  const ids = Object.keys(apps).filter((id) => !apps[id].missing && !apps[id][field]).slice(0, limit);
  console.log(`[${marketId}] ${Object.keys(apps).length} kayıt, ${field} eksik olan ${ids.length} tanesi yenilenecek`);
  if (!ids.length) return { fixed: 0, tried: 0 };

  const store = createStore({ country, lang, throttleMs, concurrency, budget: { app: ids.length + 10 }, log: (m) => console.log(m) });
  let fixed = 0;
  let done = 0;
  for (const id of ids) {
    try {
      const a = await store.app(id);
      if (a && !a.missing) {
        apps[id] = a;
        if (a[field]) fixed++;
      }
    } catch (err) {
      if (err && err.budget) break;
      console.log(`   ${id}: ${err.message}`);
    }
    if (++done % 100 === 0) {
      console.log(`   ${done}/${ids.length} · ${fixed} kayıt tamamlandı`);
      writeJson(appsPath, apps);
    }
  }
  writeJson(appsPath, apps);
  console.log(`[${marketId}] bitti: ${fixed}/${ids.length} kayıtta ${field} dolduruldu`);
  return { fixed, tried: ids.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const val = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : dflt; };
  const mi = argv.indexOf('--market');
  const index = readJson(path.join(ROOT, 'public', 'data', 'index.json'), { markets: [] });
  const ids = mi >= 0 ? [argv[mi + 1]] : (index.markets || []).map((m) => m.id);
  for (const id of ids) {
    await refresh(id, { field: val('--field', 'released'), limit: Number(val('--limit', 5000)) });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
