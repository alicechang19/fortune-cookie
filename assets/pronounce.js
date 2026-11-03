// The pronunciation coach for the Learn Chinese side of the slip:
// breaks a phrase into syllables, explains each tone (and how tones change in speech),
// and reads it aloud with the device's own Mandarin voice.

/* ------------------------------------------------------------------ pinyin */
const MARKED = {
  ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4], ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4],
  ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4], ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4],
  ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4], ǖ: ['ü', 1], ǘ: ['ü', 2], ǚ: ['ü', 3], ǜ: ['ü', 4],
};
// one pinyin syllable, written without its tone mark
const SYLLABLE = /^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:iang|iong|uang|ueng|üan|iao|ian|ing|uai|uan|ang|eng|ong|üe|ün|ai|ei|ao|ou|an|en|er|ia|ie|iu|in|ua|uo|ui|un|ue|a|o|e|i|u|ü)$/;

// "zěnmeyàng" → ["zěn", "me", "yàng"]. Inside a word, a syllable can only start with a vowel after an
// apostrophe (kě'ài), which is what makes the split unambiguous (gāngà is gān·gà, never gāng·à).
function splitWord(word) {
  const plain = [...word].map((ch) => (MARKED[ch] ? MARKED[ch][0] : ch)).join('');
  const best = new Array(plain.length + 1).fill(null); best[0] = [];
  for (let i = 0; i < plain.length; i++) {
    if (!best[i]) continue;
    for (let j = plain.length; j > i; j--) {
      const piece = plain.slice(i, j);
      if (!SYLLABLE.test(piece) || (i > 0 && /^[aoe]/.test(piece))) continue;
      const cand = best[i].concat([[i, j]]);
      if (!best[j] || cand.length < best[j].length) best[j] = cand;
    }
  }
  if (!best[plain.length]) return null;
  return best[plain.length].map(([i, j]) => [...word].slice(i, j).join(''));
}
function toneOf(syl) { for (const ch of syl) if (MARKED[ch]) return MARKED[ch][1]; return 0; }

export const TONES = {
  1: { name: '1st tone', shape: [5, 5] },
  2: { name: '2nd tone', shape: [3, 5] },
  3: { name: '3rd tone', shape: [2, 1, 4] },
  4: { name: '4th tone', shape: [5, 1] },
  0: { name: 'neutral tone', shape: [3, 3] },
  half3: { name: 'low 3rd tone', shape: [2, 1, 1] },
};

/** The phrase as syllables: each Chinese character with its pinyin, written tone and spoken tone. */
export function syllables(lesson) {
  const chars = [...lesson.zh].filter((ch) => /\p{Script=Han}/u.test(ch));
  // phrase breaks (commas and the like) stop tone changes from carrying across
  const groups = lesson.py.toLowerCase().split(/[,，]/);
  const out = [];
  groups.forEach((g, gi) => {
    for (const word of g.replace(/[!?.！？。/]/g, ' ').split(/\s+/).filter(Boolean)) {
      for (const part of word.split(/['’]/)) {
        const sylls = splitWord(part);
        if (!sylls) throw new Error(`can't read the pinyin "${part}" in ${lesson.id}`);
        for (const py of sylls) out.push({ py, tone: toneOf(py), group: gi });
      }
    }
  });
  if (out.length !== chars.length) throw new Error(`${lesson.id}: ${chars.length} characters but ${out.length} syllables`);
  out.forEach((s, i) => { s.ch = chars[i]; s.said = s.tone; });
  // tone changes: a 3rd tone before another 3rd tone is said as a 2nd tone
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1];
    if (a.group === b.group && a.tone === 3 && b.tone === 3) a.said = 2;
  }
  // a 3rd tone that stays a 3rd tone keeps its full dip-and-rise only at the end of a phrase
  out.forEach((s, i) => {
    const next = out[i + 1];
    if (s.said === 3 && next && next.group === s.group) s.said = 'half3';
  });
  return out;
}

// gǔn → gún: move the 3rd-tone mark to a 2nd-tone mark
function rising(py) { return py.replace(/[ǎěǐǒǔǚ]/, (m) => ({ ǎ: 'á', ě: 'é', ǐ: 'í', ǒ: 'ó', ǔ: 'ú', ǚ: 'ǘ' })[m]); }

/* ------------------------------------------------------------------ voice */
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voices = [];
function loadVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }
// Mandarin: Taiwanese Mandarin first (the lessons are in traditional characters), then any other Mandarin voice.
// Hong Kong voices speak Cantonese, so they are never used.
// English: an American or British voice.
// In both, the clear standard voices (Apple's, Google's, Microsoft's) beat Apple's novelty voices
// (Eddy, Grandpa, Bubbles, Zarvox, …), which are fun but a poor model for a learner.
const GOOD = {
  zh: /Meijia|美佳|Tingting|婷婷|Google|HsiaoChen|HsiaoYu|Yating|Hanhan|Zhiwei|Xiaoxiao|Yunxi|Huihui/i,
  en: /Samantha|Alex|Ava|Allison|Susan|Daniel|Karen|Moira|Serena|Google|Aria|Jenny|Guy|Zira|Libby|Sonia/i,
};
const NOVELTY = /Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy/i;
function pickVoice(kind = 'zh') {
  const pool = kind === 'zh'
    ? voices.filter((v) => /^(zh|cmn)/i.test(v.lang) && !/HK|yue/i.test(v.lang))
    : voices.filter((v) => /^en/i.test(v.lang));
  const home = kind === 'zh' ? /TW|Hant/i : /US|GB/i;
  const score = (v) => (home.test(v.lang) ? 4 : 0) + (GOOD[kind].test(v.name) ? 2 : 0) - (NOVELTY.test(v.name) ? 5 : 0) + (v.localService ? 1 : 0);
  return pool.sort((a, b) => score(b) - score(a))[0] || null;
}
export function canSpeak() { return !!synth; }
export function hasMandarinVoice() { return !!pickVoice('zh'); }

// Only the newest request reports back: starting another one, or stopSpeaking(), silences the old callback.
let speechId = 0;
/** Reads parts in order, each in its own language: [{ text, lang: 'zh' | 'en', rate }]. */
export function speakParts(parts, onend) {
  if (!synth) return false;
  synth.cancel();
  const id = ++speechId;
  let done = false;
  const finish = () => { if (done || id !== speechId) return; done = true; onend && onend(); };
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p.text);
    const v = pickVoice(p.lang);
    if (v) u.voice = v;
    u.lang = v ? v.lang : (p.lang === 'zh' ? 'zh-TW' : 'en-US');
    u.rate = p.rate || (p.lang === 'zh' ? 0.9 : 0.96);
    if (i === parts.length - 1) u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
  return true;
}
export function speak(text, rate = 0.9, onend) { return speakParts([{ text, lang: 'zh', rate }], onend); }
export function stopSpeaking() { speechId++; if (synth) synth.cancel(); }

/** What "listen" reads for the front of the slip: Chinese in a Mandarin voice, English in an English one. */
export function fortuneParts(f) {
  if (f.kind === 'proverb') return [{ text: f.zh, lang: 'zh', rate: 0.85 }, { text: f.meaning, lang: 'en' }];
  return [{ text: f.zh, lang: 'zh', rate: 0.8 }, { text: f.en, lang: 'en' }]; // poem: the line and its translation, not the poet
}

/* ------------------------------------------------------------------ the coach card */
function contour(shape) {
  const W = 44, H = 30, pts = shape.map((lv, i) => `${(i / (shape.length - 1)) * (W - 8) + 4},${H - 4 - ((lv - 1) / 4) * (H - 8)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`
    + [1, 3, 5].map((lv) => `<line x1="2" x2="${W - 2}" y1="${H - 4 - ((lv - 1) / 4) * (H - 8)}" y2="${H - 4 - ((lv - 1) / 4) * (H - 8)}" class="grid"/>`).join('')
    + `<polyline points="${pts}" class="pitch"/></svg>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Builds the coach into `root` (the dialog element).
 * Returns open(lesson) / close() / isOpen().
 */
export function createCoach(root, { onClose } = {}) {
  let lastFocus = null, current = null;
  const setPlaying = (btn) => root.querySelectorAll('[data-rate]').forEach((b) => b.classList.toggle('playing', b === btn));

  function play(btn) {
    if (!current) return;
    const rate = Number(btn.dataset.rate);
    setPlaying(btn);
    if (!speak(current.zh, rate, () => setPlaying(null))) setPlaying(null);
  }
  function close() {
    if (root.hidden) return;
    stopSpeaking(); setPlaying(null);
    root.classList.remove('show');
    root.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    onClose && onClose();
  }
  function open(lesson) {
    current = lesson;
    const sylls = syllables(lesson);
    const voiceNote = !canSpeak()
      ? '<p class="coach-note">This browser can’t speak aloud, but the tones below show how to say it.</p>'
      : '';
    root.innerHTML = `
      <div class="coach-card" role="document" tabindex="-1">
        <button class="coach-close" type="button" aria-label="Close">×</button>
        <div class="coach-body">
        <p class="coach-kicker">Learn Chinese</p>
        <h2 class="coach-zh" id="coach-title" lang="zh-Hant-TW">${esc(lesson.zh)}</h2>
        <p class="coach-py">${esc(lesson.py)}</p>
        <p class="coach-en">${esc(lesson.en)}</p>
        <div class="coach-play">
          <button type="button" data-rate="0.8"><span aria-hidden="true">🔊</span> Listen</button>
        </div>
        ${voiceNote}
        <ol class="coach-sylls" aria-label="Syllable by syllable">
          ${sylls.map((s) => {
            const said = TONES[s.said], changed = s.said !== s.tone;
            return `<li>
              <span class="ch" lang="zh-Hant-TW">${esc(s.ch)}</span>
              <span class="py">${esc(changed && s.said === 2 ? rising(s.py) : s.py)}</span>
              ${contour(said.shape)}
              <span class="tone">${changed && s.said === 2 ? `said as 2nd tone` : said.name}</span>
            </li>`;
          }).join('')}
        </ol>
        </div>
      </div>`;
    root.querySelector('.coach-close').addEventListener('click', close);
    root.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => play(b)));
    lastFocus = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('show'));
    // focus the card (not a button) so screen readers start at the top and no focus ring flashes on tap
    root.querySelector('.coach-card').focus({ preventScroll: true });
  }
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    // keep keyboard focus inside the card
    const f = [...root.querySelectorAll('button')]; if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return { open, close, isOpen: () => !root.hidden };
}
