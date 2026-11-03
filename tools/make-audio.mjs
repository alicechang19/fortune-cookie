#!/usr/bin/env node
// Records the Chinese on every slip as an mp3 in assets/audio/, using a cloud text-to-speech voice,
// so "listen" sounds the same in every browser (some browsers have no Mandarin voice, or skip it).
//
//   node tools/make-audio.mjs              record whatever is missing
//   node tools/make-audio.mjs --force      re-record everything
//   node tools/make-audio.mjs P12 M03      re-record just these
//
// Needs one of these, in the environment or in ~/.config/fortune-cookie/tts.env (KEY=value lines):
//   AZURE_SPEECH_KEY + AZURE_SPEECH_REGION   Azure AI Speech, voice zh-TW-HsiaoChenNeural
//   GOOGLE_TTS_API_KEY                       Google Cloud Text-to-Speech, voice cmn-TW-Wavenet-A
// Both providers' free tiers cover this easily (about 2,000 characters in all).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRONTS, LESSONS } from '../assets/fortunes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'audio');

// keys: environment first, then the private env file (never printed, never committed)
const env = { ...process.env };
const envFile = join(homedir(), '.config', 'fortune-cookie', 'tts.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const providers = {
  azure: {
    ready: () => env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION,
    voice: 'zh-TW-HsiaoChenNeural',
    async record(text, slower) {
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW"><voice name="${this.voice}"><prosody rate="${slower ? '-15%' : '-5%'}">${esc(text)}</prosody></voice></speak>`;
      const r = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'fortune-cookie-audio',
        },
        body: ssml,
      });
      if (!r.ok) throw new Error(`Azure ${r.status} ${r.statusText} ${(await r.text()).slice(0, 200)}`);
      return Buffer.from(await r.arrayBuffer());
    },
  },
  google: {
    ready: () => env.GOOGLE_TTS_API_KEY,
    voice: 'cmn-TW-Wavenet-A',
    async record(text, slower) {
      const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.GOOGLE_TTS_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'cmn-TW', name: this.voice },
          audioConfig: { audioEncoding: 'MP3', speakingRate: slower ? 0.85 : 0.95 },
        }),
      });
      if (!r.ok) throw new Error(`Google ${r.status} ${r.statusText} ${(await r.text()).slice(0, 200)}`);
      return Buffer.from((await r.json()).audioContent, 'base64');
    },
  },
};
const name = Object.keys(providers).find((k) => providers[k].ready());
if (!name) {
  console.error(`No text-to-speech key found. Put AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, or GOOGLE_TTS_API_KEY, in ${envFile}`);
  process.exit(1);
}
const provider = providers[name];

// fronts at a natural pace; lessons a little slower, for learners
const items = [
  ...FRONTS.map((f) => ({ id: f.id, text: f.zh, slower: false })),
  ...LESSONS.map((l) => ({ id: l.id, text: l.zh, slower: true })),
];
const args = process.argv.slice(2), force = args.includes('--force'), only = args.filter((a) => !a.startsWith('--'));
const todo = items.filter((it) => (only.length ? only.includes(it.id) : force || !existsSync(join(outDir, `${it.id}.mp3`))));

mkdirSync(outDir, { recursive: true });
console.log(`Recording ${todo.length} of ${items.length} clips with ${name} (${provider.voice})`);
let failed = 0;
const queue = todo.slice();
async function worker() {
  for (let it; (it = queue.shift());) {
    for (let attempt = 1; ; attempt++) {
      try {
        const mp3 = await provider.record(it.text, it.slower);
        writeFileSync(join(outDir, `${it.id}.mp3`), mp3);
        console.log(`  ${it.id}  ${it.text}  (${(mp3.length / 1024).toFixed(1)} KB)`);
        break;
      } catch (e) {
        if (attempt < 4 && /\b(429|5\d\d)\b/.test(e.message)) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        console.error(`  ${it.id} failed: ${e.message}`); failed++; break;
      }
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

// the page only tries clips listed here, so a missing one quietly falls back to the browser's voice
const ids = new Set(items.map((it) => it.id));
const have = readdirSync(outDir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)).filter((id) => ids.has(id)).sort();
writeFileSync(join(outDir, 'clips.json'), JSON.stringify(have) + '\n');
console.log(`${have.length} clips listed in assets/audio/clips.json${failed ? `, ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
