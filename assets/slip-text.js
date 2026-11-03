// Lays out the printed text on the two sides of a fortune slip.
// Each kind of entry is a list of blocks (a line of text, or a row of differently styled runs);
// everything is scaled down together until it fits the slip.

// traditional-character fonts first so 讓, 錦, 鍾… get their Taiwanese forms
const CJK = '"PingFang TC", "Hiragino Sans TC", "Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", "Heiti TC"';
const SANS = `"Helvetica Neue", Helvetica, Arial, ${CJK}, sans-serif`;
const ZH = `${CJK}, "Helvetica Neue", Helvetica, sans-serif`;
const INK = '#1d1c1a', SOFT = '#6e6359', RED = '#c4231c';

const fontOf = (r, s) => `${r.italic ? 'italic ' : ''}${r.weight || 400} ${Math.round(r.size * s)}px ${r.zh ? ZH : SANS}`;

// English wraps between words; Chinese wraps after its commas
function tokens(b) { return b.zh ? b.text.split(/(?<=[，、；])/) : b.text.split(' '); }
function wrap(c, b, maxW) {
  const parts = tokens(b), sep = b.zh ? '' : ' ', lines = []; let line = '';
  for (const p of parts) {
    const t = line ? line + sep + p : p;
    if (c.measureText(t).width > maxW && line) { lines.push(line); line = p; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
// same number of lines, but as even as possible (no lonely last word)
function balanced(c, b, maxW) {
  let lines = wrap(c, b, maxW);
  if (lines.length < 2) return lines;
  let lo = maxW * 0.4, hi = maxW;
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (wrap(c, b, mid).length > lines.length) lo = mid; else hi = mid; }
  return wrap(c, b, hi);
}

function fit(c, blocks, W, H) {
  const maxW = W * 0.86, maxH = H * 0.84;
  let rows, total, used;
  for (let s = 1; s > 0.4; s -= 0.02) {
    used = s; rows = []; total = 0; let ok = true;
    for (const b of blocks) {
      const gap = (b.gap || 0) * s;
      if (b.runs) {
        const ws = b.runs.map((r) => { c.font = fontOf(r, s); return c.measureText(r.text).width; });
        const between = (b.between ?? 34) * s, w = ws.reduce((a, x) => a + x, 0) + between * (ws.length - 1);
        if (w <= maxW) {
          const h = Math.max(...b.runs.map((r) => r.size)) * s * 1.22;
          rows.push({ runs: b.runs, ws, between, w, h, gap }); total += h + gap;
        } else {
          // too wide for one row: stack the runs (characters above pinyin)
          b.runs.forEach((r, i) => {
            if (ws[i] > maxW) ok = false;
            const h = r.size * s * 1.2, g = i ? 8 * s : gap;
            rows.push({ runs: [r], ws: [ws[i]], between: 0, w: ws[i], h, gap: g }); total += h + g;
          });
        }
      } else {
        c.font = fontOf(b, s);
        const lines = balanced(c, b, maxW);
        if (lines.length > (b.max || 1)) ok = false;
        lines.forEach((text, i) => {
          const h = b.size * s * 1.2, g = i ? 0 : gap;
          rows.push({ runs: [{ ...b, text }], ws: [c.measureText(text).width], between: 0, w: c.measureText(text).width, h, gap: g }); total += h + g;
        });
      }
    }
    if (ok && total <= maxH) return { rows, total, s, fits: true };
  }
  return { rows, total, s: used, fits: false };
}

function paint(c, blocks, W, H) {
  const { rows, total, s, fits } = fit(c, blocks, W, H);
  c.textBaseline = 'middle'; c.textAlign = 'left';
  let y = (H - total) / 2;
  for (const row of rows) {
    y += row.gap;
    let x = W / 2 - row.w / 2;
    row.runs.forEach((r, i) => {
      c.font = fontOf(r, s); c.fillStyle = r.color || INK;
      c.fillText(r.text, x, y + row.h / 2 + (r.zh ? 0 : row.h * 0.02));
      x += row.ws[i] + row.between;
    });
    y += row.h;
  }
  return { scale: s, fits };
}

/* ------------------------------------------------------------------ front: the fortune */
// sizes are in pixels on the 2048-wide slip texture; fit() only ever shrinks them.
// The cookie's own commentary (`says` in fortunes.js) isn't printed on either side.
export function frontBlocks(f) {
  if (f.kind === 'proverb') return [
    { runs: [{ text: f.zh, zh: true, size: 80, weight: 500 }, { text: f.py, size: 50, color: SOFT }], between: 28 },
    { text: f.meaning, size: 56, weight: 500, max: 2, gap: 16 },
  ];
  return [ // poem
    { text: f.zh, zh: true, size: 70, weight: 500, max: 2 },
    { text: f.en, size: 50, max: 2, gap: 18 },
    { text: `— ${f.poet}, ${f.title} (${f.titleEn})`, size: 38, color: SOFT, gap: 14 },
  ];
}
export function paintFront(c, f, W, H) { return paint(c, frontBlocks(f), W, H); }

/* ------------------------------------------------------------------ back: a Mandarin lesson and lucky numbers */
export function backBlocks(l, lucky) {
  return [
    { text: 'Learn Chinese', size: 40, weight: 600, color: SOFT },
    { runs: [{ text: l.zh, zh: true, size: 84, weight: 500 }, { text: l.py, size: 52, color: SOFT }], gap: 12, between: 30 },
    { text: l.en, size: 54, max: 2, gap: 8 },
    { text: `Lucky Numbers  ${lucky.join(', ')}`, size: 46, weight: 500, color: RED, gap: 18 },
  ];
}
export function paintBack(c, l, lucky, W, H) { return paint(c, backBlocks(l, lucky), W, H); }
