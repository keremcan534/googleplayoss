/*
 * Tarayıcıda canvas ile görsel üretimi: ikon ve logo taslağı, tanıtım görseli,
 * başlıklı ekran görüntüleri. Çıktılar Play şartlarına göre denetlenir:
 *   ikon 512×512 PNG · tanıtım görseli 1024×500 JPEG (alfasız) · ekran görüntüleri JPEG (alfasız).
 * Ekran görüntüsü taslağı her zaman kullanıcının yüklediği GERÇEK oyun görüntüsünden yapılır.
 */
import { encodePngRgb, imageInfo, validateImage } from './binary.js';

function canvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return { c, g: c.getContext('2d') };
}

async function toBytes(c, type, quality) {
  const blob = c.convertToBlob ? await c.convertToBlob({ type, quality }) : await new Promise((r) => c.toBlob(r, type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

async function bitmapOf(asset) {
  return createImageBitmap(new Blob([asset.bytes], { type: asset.type }));
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function fit(g, text, maxW, size, min, weight = 800) {
  let s = size;
  for (; s > min; s -= 2) {
    g.font = `${weight} ${s}px ${FONT}`;
    if (g.measureText(text).width <= maxW) return s;
  }
  g.font = `${weight} ${min}px ${FONT}`;
  return min;
}

function wrap(g, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last.length > 1 && g.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    keep[maxLines - 1] = `${last.trim()}…`;
    return keep;
  }
  return lines;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hexRgba(hex, a) {
  const h = String(hex || '#000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function initials(name) {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const s = (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)) || '?';
  return s.toLocaleUpperCase('tr-TR');
}

function drawCover(g, bmp, x, y, w, h) {
  const s = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * s;
  const dh = bmp.height * s;
  g.drawImage(bmp, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function containRect(bmp, x, y, w, h) {
  const s = Math.min(w / bmp.width, h / bmp.height);
  const dw = Math.round(bmp.width * s);
  const dh = Math.round(bmp.height * s);
  return { x: Math.round(x + (w - dw) / 2), y: Math.round(y + (h - dh) / 2), w: dw, h: dh };
}

/**
 * @param {{putAsset:(a)=>Promise<string>, getAsset:(id)=>Promise<object>}} io
 */
export function createRenderer(io) {
  const save = async (project, kind, bytes, type, w, h, check) => {
    const info = imageInfo(bytes);
    const issues = check ? validateImage(check, info, bytes.length) : [];
    const assetId = await io.putAsset({ projectId: project.id, kind, type, bytes, w, h });
    return { assetId, w, h, type, size: bytes.length, issues };
  };

  async function icon(project, brand) {
    const [c1, c2, c3] = brand.palette;
    const { c, g } = canvas(512, 512);
    const bg = g.createLinearGradient(0, 0, 512, 512);
    bg.addColorStop(0, c1);
    bg.addColorStop(1, c2);
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 512);
    // yumuşak ışık
    const glow = g.createRadialGradient(170, 150, 20, 170, 150, 360);
    glow.addColorStop(0, 'rgba(255,255,255,0.18)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 512, 512);
    // güvenli alan içinde halka + monogram (Play maskesi köşeleri keser)
    g.strokeStyle = hexRgba(c3, 0.9);
    g.lineWidth = 14;
    g.beginPath();
    g.arc(256, 256, 176, 0, Math.PI * 2);
    g.stroke();
    const txt = initials(project.name);
    fit(g, txt, 250, 210, 80, 900);
    g.fillStyle = c3;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 6;
    g.fillText(txt, 256, 266);
    const img = g.getImageData(0, 0, 512, 512);
    const bytes = await encodePngRgb(img.data, 512, 512);
    return save(project, 'icon', bytes, 'image/png', 512, 512, 'icon');
  }

  async function logo(project, brand) {
    const [c1, , c3] = brand.palette;
    const W = 1200; const H = 360;
    const { c, g } = canvas(W, H);
    g.clearRect(0, 0, W, H);
    const size = fit(g, project.name, W - 120, 170, 48, 900);
    g.fillStyle = c1;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const y = H / 2 + size * 0.34;
    g.fillText(project.name, W / 2, y);
    const tw = Math.min(g.measureText(project.name).width, W - 120);
    g.fillStyle = c3;
    roundRect(g, (W - tw) / 2, y + 22, tw * 0.36, 16, 8);
    g.fill();
    const bytes = await toBytes(c, 'image/png');
    return save(project, 'logo', bytes, 'image/png', W, H, null);
  }

  async function featureGraphic(project, plan) {
    const brand = project.pack.items.brand.value || { palette: ['#1F3A5F', '#0F2238', '#F2A93B'] };
    const [c1, c2, c3] = brand.palette;
    const W = 1024; const H = 500;
    const { c, g } = canvas(W, H);
    const shot = (project.inputs.screens || [])[0];
    const raw = shot ? await io.getAsset(shot.assetId) : null;
    if (raw) {
      const bmp = await bitmapOf(raw);
      drawCover(g, bmp, 0, 0, W, H);
      bmp.close && bmp.close();
    } else {
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, c1);
      bg.addColorStop(1, c2);
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = hexRgba(c3, 0.16);
      g.beginPath();
      g.moveTo(W * 0.62, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W * 0.46, H);
      g.closePath();
      g.fill();
    }
    const shade = g.createLinearGradient(0, 0, W * 0.75, 0);
    shade.addColorStop(0, hexRgba(c2, 0.92));
    shade.addColorStop(0.55, hexRgba(c2, 0.55));
    shade.addColorStop(1, hexRgba(c2, 0));
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
    const x = 84;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const size = fit(g, plan.headline, 520, 84, 40, 900);
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.4)';
    g.shadowBlur = 12;
    g.fillText(plan.headline, x, 220 + size * 0.2);
    g.shadowBlur = 0;
    g.fillStyle = c3;
    roundRect(g, x, 250 + size * 0.2, 120, 10, 5);
    g.fill();
    if (plan.tagline) {
      g.font = `600 30px ${FONT}`;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      wrap(g, plan.tagline, 500, 2).forEach((l, i) => g.fillText(l, x, 310 + size * 0.2 + i * 40));
    }
    const bytes = await toBytes(c, 'image/jpeg', 0.92);
    return save(project, 'featureGraphic', bytes, 'image/jpeg', W, H, 'featureGraphic');
  }

  async function screenshots(project, plan) {
    const brand = project.pack.items.brand.value || { palette: ['#1F3A5F', '#0F2238', '#F2A93B'] };
    const [c1, c2, c3] = brand.palette;
    const frame = project.inputs.frameScreens !== false;
    const out = [];
    const shots = (project.inputs.screens || []).slice(0, 8);
    for (let i = 0; i < shots.length; i++) {
      const raw = await io.getAsset(shots[i].assetId);
      if (!raw) continue;
      const bmp = await bitmapOf(raw);
      const caption = (shots[i].caption || (plan.slides[i] && plan.slides[i].caption) || '').trim();
      let W; let H;
      if (frame) ({ w: W, h: H } = plan.size);
      else {
        // çerçevesiz: kendi boyutu, Play sınırlarına sığdırılır
        const s = Math.min(1, 3840 / Math.max(bmp.width, bmp.height));
        W = Math.round(bmp.width * s); H = Math.round(bmp.height * s);
      }
      const { c, g } = canvas(W, H);
      if (!frame) {
        g.drawImage(bmp, 0, 0, W, H);
      } else {
        const bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, c1);
        bg.addColorStop(1, c2);
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        const landscape = W > H;
        const band = Math.round(H * (landscape ? 0.17 : 0.15));
        const pad = Math.round(Math.min(W, H) * 0.05);
        if (caption) {
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const size = fit(g, caption, W - pad * 4, Math.round(band * 0.5), Math.round(band * 0.26), 850);
          g.fillStyle = '#ffffff';
          g.fillText(caption, W / 2, band * 0.56);
          g.fillStyle = c3;
          roundRect(g, W / 2 - size * 1.2, band * 0.56 + size * 0.7, size * 2.4, Math.max(6, size * 0.12), 4);
          g.fill();
        }
        const area = { x: pad, y: caption ? band + pad * 0.4 : pad, w: W - pad * 2, h: H - (caption ? band + pad * 0.4 : pad) - pad };
        const r = containRect(bmp, area.x, area.y, area.w, area.h);
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.45)';
        g.shadowBlur = 40;
        g.shadowOffsetY = 12;
        roundRect(g, r.x, r.y, r.w, r.h, Math.round(Math.min(W, H) * 0.025));
        g.fillStyle = '#000';
        g.fill();
        g.restore();
        g.save();
        roundRect(g, r.x, r.y, r.w, r.h, Math.round(Math.min(W, H) * 0.025));
        g.clip();
        g.drawImage(bmp, r.x, r.y, r.w, r.h);
        g.restore();
      }
      bmp.close && bmp.close();
      const bytes = await toBytes(c, 'image/jpeg', 0.92);
      const res = await save(project, 'screenshot', bytes, 'image/jpeg', W, H, 'screenshot');
      out.push({ ...res, caption, rawId: shots[i].assetId });
    }
    return out;
  }

  return { icon, logo, featureGraphic, screenshots };
}

/** Yüklenen dosyayı okur, boyut/alfa bilgisini ve Play denetimini döndürür. */
export async function readUpload(file, kind) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = imageInfo(bytes);
  const issues = validateImage(kind, info, bytes.length);
  return { bytes, info, issues, type: info.type || file.type, w: info.width, h: info.height, name: file.name };
}

/** Alfalı PNG'yi (ör. ekran görüntüsü, tanıtım görseli) alfasız JPEG'e çevirir. */
export async function flattenToJpeg(bytes, type) {
  const bmp = await createImageBitmap(new Blob([bytes], { type }));
  const { c, g } = canvas(bmp.width, bmp.height);
  g.fillStyle = '#000';
  g.fillRect(0, 0, bmp.width, bmp.height);
  g.drawImage(bmp, 0, 0);
  const out = await toBytes(c, 'image/jpeg', 0.92);
  const w = bmp.width; const h = bmp.height;
  bmp.close && bmp.close();
  return { bytes: out, type: 'image/jpeg', w, h };
}
