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
// a voice that has actually spoken this visit goes first; one that failed goes last
const worked = {}, failed = new Set();
function rankVoices(kind = 'zh') {
  const pool = kind === 'zh'
    ? voices.filter((v) => /^(zh|cmn)/i.test(v.lang) && !/HK|yue/i.test(v.lang))
    : voices.filter((v) => /^en/i.test(v.lang));
  const home = kind === 'zh' ? /TW|Hant/i : /US|GB/i;
  // In Chrome, its own Google Mandarin voice comes first: Chrome has been seen to "play" Apple's Mandarin
  // voices (Meijia) in a few milliseconds without a sound. Browsers without it (Safari, phones) use Meijia.
  const chromeMandarin = (v) => kind === 'zh' && /^Google/.test(v.name);
  const score = (v) => (v === worked[kind] ? 100 : 0) - (failed.has(v.voiceURI) ? 100 : 0) + (chromeMandarin(v) ? 3 : 0)
    + (home.test(v.lang) ? 4 : 0) + (GOOD[kind].test(v.name) ? 2 : 0) - (NOVELTY.test(v.name) ? 5 : 0) + (v.localService ? 1 : 0);
  return pool.sort((a, b) => score(b) - score(a));
}
function pickVoice(kind = 'zh') {
  return rankVoices(kind)[0] || null;
}
export function canSpeak() { return !!synth || typeof Audio !== 'undefined'; }
// ?debug in the page address logs every spoken part to the console
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const DEBUG = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search);
// On a local server, debug lines are also posted to /__speechlog so they can be read without the console.
const debugLines = [];
let debugSend = 0;
const dbg = (...a) => {
  if (!DEBUG) return;
  console.log('[speech]', ...a);
  debugLines.push(`${Math.round(now())}ms ${a.join(' ')}`);
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    clearTimeout(debugSend);
    debugSend = setTimeout(() => {
      const body = debugLines.splice(0).join('\n');
      fetch('/__speechlog', { method: 'POST', body }).catch(() => {});
    }, 400);
  }
};
if (DEBUG && synth) {
  dbg('browser:', navigator.userAgent);
  const list = () => dbg('voices:', voices.filter((v) => /^(zh|cmn|en)/i.test(v.lang)).map((v) => `${v.name} [${v.lang}${v.localService ? '' : ', online'}${v.default ? ', default' : ''}]`).join('; ') || 'none yet');
  list(); synth.addEventListener?.('voiceschanged', list);
}
export function hasMandarinVoice() { return !!pickVoice('zh'); }

/* ------------------------------------------------------------------ recorded clips */
// Chinese can come from recorded clips (assets/audio/<id>.mp3, made by tools/make-audio.mjs) instead of the
// browser's voices, which some browsers lack or skip. clips.json lists the clips that exist; anything
// missing falls back to the browser's voice.
let clipSet = new Set();
if (typeof fetch !== 'undefined' && typeof location !== 'undefined') {
  fetch(new URL('./audio/clips.json', import.meta.url)).then((r) => (r.ok ? r.json() : [])).then((ids) => { clipSet = new Set(ids); dbg('clips:', clipSet.size); }).catch(() => {});
}
const player = typeof Audio !== 'undefined' ? new Audio() : null;
if (player) player.preload = 'auto';
const clipURL = (id) => new URL(`./audio/${id}.mp3`, import.meta.url).href;

// Only the newest request plays on and reports back: starting another one, or stopSpeaking(), ends the old one.
let speechId = 0, speaking = null, cancelledAt = -1e9; // `speaking` holds the live utterance so it isn't garbage-collected mid-sentence
function cancelAll() { cancelledAt = now(); synth.cancel(); }
/**
 * Reads parts in order, each in its own language: [{ text, lang: 'zh' | 'en', rate, clip }].
 * A part with a `clip` id plays that recording when there is one; otherwise the browser's voice reads it.
 * Each part starts when the one before it ends. Queueing them all up front isn't reliable: right after
 * cancel() (as when listening again mid-sentence), browsers can drop everything but the first part,
 * and Chrome can drop the first part too.
 */
export function speakParts(parts, onend) {
  if (!synth && !player) return false;
  const id = ++speechId;
  if (player && !player.paused) player.pause();
  // Chrome silently drops speech queued straight after cancel(), so only cancel when something is playing
  const busy = !!synth && (synth.speaking || synth.pending);
  if (busy) cancelAll();
  const settle = busy || now() - cancelledAt < 150;
  if (synth && synth.paused) synth.resume(); // Chrome can be left paused, which swallows everything after
  const say = (i) => {
    if (id !== speechId) return;
    if (i >= parts.length) { speaking = null; onend && onend(); return; }
    const p = parts[i];
    let moved = false;
    const next = () => { if (!moved && id === speechId) { moved = true; say(i + 1); } };
    // Read with the device's voices. Some browsers accept a voice and then never say anything (desktop
    // Chrome has skipped Mandarin this way), so if a voice doesn't start speaking, fails, or ends without
    // a sound, cancel it and try the next one: up to three voices before moving on.
    const voice = () => {
      if (moved || id !== speechId) return;
      if (!synth) { next(); return; }
      const ranked = rankVoices(p.lang).slice(0, 3);
      const attempt = (k) => {
        if (moved || id !== speechId) return;
        const v = ranked[k] || null;
        const u = new SpeechSynthesisUtterance(p.text);
        if (v) u.voice = v;
        u.lang = v ? v.lang : (p.lang === 'zh' ? 'zh-TW' : 'en-US');
        u.rate = p.rate || (p.lang === 'zh' ? 0.9 : 0.96);
        const sentAt = now();
        let started = false, startedAt = 0, settled = false, timer = 0;
        // the shortest time this text could really take to say: about 5 Chinese characters or 15 letters a second, at most
        const shortest = Math.max(250, ((p.text.match(/\p{Script=Han}/gu) || []).length * 200 + (p.text.match(/[a-z]/gi) || []).length * 25) / Math.max(1, u.rate) * 0.35);
        const giveUp = (why) => {
          if (settled || id !== speechId) return;
          settled = true; clearTimeout(timer);
          if (v) failed.add(v.voiceURI);
          dbg(`${v ? v.name : 'default voice'} didn't speak (${why})`);
          if (k + 1 < ranked.length) { cancelAll(); setTimeout(() => attempt(k + 1), 150); } else { if (synth.speaking || synth.pending) cancelAll(); next(); }
        };
        u.onstart = () => { started = true; startedAt = now(); clearTimeout(timer); dbg('start', p.text); };
        u.onend = () => {
          if (settled) return;
          const took = now() - (started ? startedAt : sentAt);
          // "finished" faster than anyone could say it: the voice played nothing
          if (took < shortest) { giveUp(`finished in ${Math.round(took)}ms, too fast to have said it`); return; }
          settled = true; clearTimeout(timer);
          if (v) { worked[p.lang] = v; failed.delete(v.voiceURI); }
          dbg('end', p.text); next();
        };
        u.onerror = (e) => {
          dbg('error', e.error, p.text);
          // cut off by a newer request (or by our own retry): just stop
          if (settled || e.error === 'interrupted' || e.error === 'canceled') return;
          giveUp(e.error);
        };
        timer = setTimeout(() => { if (!started) giveUp('never started'); }, 3000);
        speaking = u;
        dbg(`speak part ${i + 1}/${parts.length} with ${v ? `${v.name} (${v.lang})` : `no voice found, asking for ${u.lang}`}:`, p.text);
        synth.speak(u);
      };
      attempt(0);
    };
    if (p.clip && player && clipSet.has(p.clip)) {
      dbg(`play clip ${p.clip} for part ${i + 1}/${parts.length}:`, p.text);
      // if the recording can't play, the browser's voice reads it instead
      let fellBack = false; // the error event and the play() promise can both report the same failure
      const fallback = (why) => { if (fellBack) return; fellBack = true; dbg('clip failed, using the voice:', why); voice(); };
      player.onended = () => { dbg('end', p.text); next(); };
      player.onerror = () => fallback(player.error && player.error.code);
      player.src = clipURL(p.clip);
      speaking = player;
      const pr = player.play();
      if (pr && pr.catch) pr.catch((e) => { if (e.name !== 'AbortError') fallback(e.name); });
      return;
    }
    voice();
  };
  // the first part goes out within the tap (iOS wants that); after interrupting, give cancel() a moment to settle
  dbg(`listen: ${parts.length} part(s)${synth ? `; speaking=${synth.speaking} pending=${synth.pending} paused=${synth.paused}` : ''}${busy ? ', cancelled what was playing' : ''}`);
  if (settle) setTimeout(() => say(0), 150); else say(0);
  return true;
}
export function speak(text, rate = 0.9, onend) { return speakParts([{ text, lang: 'zh', rate }], onend); }
export function stopSpeaking() {
  speechId++; speaking = null;
  if (player && !player.paused) player.pause();
  if (synth) cancelAll();
}

/** What "listen" reads for the front of the slip: the Chinese (a recording when there is one), then the English. */
export function fortuneParts(f) {
  const en = f.kind === 'proverb' ? f.meaning : f.en; // poems: the line and its translation, not the poet
  return [{ text: f.zh, lang: 'zh', rate: f.kind === 'proverb' ? 0.85 : 0.8, clip: f.id }, { text: en, lang: 'en' }];
}
/** What "Listen" reads on the Learn Chinese card: the phrase, then its English translation. */
export function lessonParts(l, rate = 0.8) {
  return [{ text: l.zh, lang: 'zh', rate, clip: l.id }, { text: l.en, lang: 'en' }];
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
    // like the front of the slip: the Chinese first, then its English translation
    if (!speakParts(lessonParts(current, rate), () => setPlaying(null))) setPlaying(null);
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
