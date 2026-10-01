// Kural ipuçları: bir pazarın yanlış pozitif kurallarının ihtiyaç duyduğu, başka pazarın
// verisinden türeyen küçük listeler. Tarayıcı ve yeniden puanlama sonrası veri setine yazılır.
import fs from 'node:fs';
import path from 'node:path';
import { tokens } from './util.js';

/**
 * Türkçe pazarda noktasız yazılmış İngilizce kelimeler ("gıf", "ınternet", "wıfı"):
 * ı → i çevrilince ABD pazarındaki uygulama başlıklarında geçen ve Türkçe başka harf içermeyen
 * kelimeler. Türkçe başlıklardan kurulmaz (ASCII Türkçe "oyunlari" İngilizce sanılırdı).
 */
export function dotlessEnglish(trKeywords, usApps) {
  const en = new Set();
  for (const a of Object.values(usApps || {})) for (const t of tokens(a.title, 'en')) if (t.length >= 2) en.add(t);
  const out = new Set();
  for (const r of trKeywords || []) {
    for (const t of String(r.k).split(' ')) {
      if (!t.includes('ı') || /[çğöşü]/.test(t)) continue;
      const dotted = t.replace(/ı/g, 'i');
      if (en.has(dotted) && !en.has(t)) out.add(t);
    }
  }
  return [...out].sort();
}

/** public/data altındaki pazar dosyası için ipuçlarını hesaplar. */
export function flagHintsFor(marketId, data, publicDir) {
  if (!marketId.endsWith('-tr')) return null;
  let us = null;
  try { us = JSON.parse(fs.readFileSync(path.join(publicDir, 'us-en.json'), 'utf8')); } catch { us = null; }
  if (!us || !us.apps) return null;
  return { dotlessEn: dotlessEnglish(data.keywords, us.apps) };
}
