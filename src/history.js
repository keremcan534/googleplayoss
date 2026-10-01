// İleriye dönük kayıt: her taramada analiz edilen kelimelerin ilk 10'u ve o çalıştırmada
// tazelenen uygulamaların yükleme sayıları, aylık JSONL dosyalarına eklenir.
//
// Neden: doğrulama, geçmişe dönük "hayatta kalanlar" verisiyle sınırlı. 60-90 günlük anlık
// görüntüler; yeni bir uygulamanın kaç günde sıralamaya girdiğini, sıra başına günlük yükleme
// farkını ve kararın ileriye dönük isabetini ölçmeyi sağlar.
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} marketDir data/<pazar>
 * @param {{date:string, serp:Object<string,string[]>, apps:Object<string,number>}} snap
 * @returns {string|null} yazılan dosya
 */
export function appendHistory(marketDir, snap) {
  const serpN = Object.keys(snap.serp || {}).length;
  const appN = Object.keys(snap.apps || {}).length;
  if (!serpN && !appN) return null;
  const dir = path.join(marketDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${snap.date.slice(0, 7)}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify({ d: snap.date, serp: snap.serp, apps: snap.apps })}\n`);
  return file;
}

/** Bir pazarın tüm geçmiş satırlarını okur (analiz betikleri için). */
export function readHistory(marketDir) {
  const dir = path.join(marketDir, 'history');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort(); } catch { return []; }
  const rows = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* bozuk satırı atla */ }
    }
  }
  return rows;
}
