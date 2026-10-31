/** Synthesized sound effects (Web Audio): no files to load or license. */

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = (() => { try { return localStorage.getItem("pick15-muted") === "1"; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem("pick15-muted", m ? "1" : "0"); } catch {}
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    out = ctx.createGain();
    out.gain.value = .8;
    out.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * .2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Browsers only allow audio after a user gesture; call this from the first one. */
export const unlockAudio = () => void audio();

interface Tone { f: number; at?: number; dur: number; type?: OscillatorType; vol?: number; to?: number }

function tone(c: AudioContext, { f, at = 0, dur, type = "sine", vol = .2, to }: Tone) {
  const start = c.currentTime + at, osc = c.createOscillator(), gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, start + dur);
  osc.connect(gain).connect(out!);
  osc.start(start);
  osc.stop(start + dur + .05);
}

/** A short filtered noise burst: the "snap" of a card. */
function snap(c: AudioContext, at: number, vol: number, freq: number) {
  const start = c.currentTime + at, src = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
  src.buffer = noiseBuf;
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(.0001, start + .06);
  src.connect(filter).connect(gain).connect(out!);
  src.start(start);
  src.stop(start + .08);
}

const play = (fn: (c: AudioContext) => void) => { const c = audio(); if (c) fn(c); };
const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;

export const sfx = {
  /** You take a card. */
  pick: () => play(c => { snap(c, 0, .35, 2600); tone(c, { f: 560, dur: .12, type: "triangle", vol: .16, to: 420 }); }),
  /** Your opponent takes a card. */
  oppPick: () => play(c => { snap(c, 0, .22, 1500); tone(c, { f: 340, dur: .14, type: "triangle", vol: .13, to: 260 }); }),
  /** Cards dealt for a new game. */
  deal: () => play(c => { for (let i = 0; i < 9; i++) snap(c, i * .035, .12, 1800 + i * 120); }),
  win: () => play(c => {
    [C5, E5, G5, C6].forEach((f, i) => tone(c, { f, at: i * .09, dur: .35, type: "triangle", vol: .17 }));
    [C6, E5 * 2, G5 * 2].forEach((f, i) => tone(c, { f, at: .4 + i * .05, dur: .7, vol: .07 }));
  }),
  lose: () => play(c => {
    [392, 329.63, 261.63].forEach((f, i) => tone(c, { f, at: i * .16, dur: .4, vol: .15 }));
    tone(c, { f: 196, at: .5, dur: .8, type: "triangle", vol: .11, to: 174 });
  }),
  draw: () => play(c => {
    tone(c, { f: 440, dur: .3, vol: .14 });
    tone(c, { f: 440, at: .22, dur: .55, vol: .08 });
    tone(c, { f: 554.37, at: .22, dur: .55, vol: .11 });
  }),
  count: () => play(c => tone(c, { f: 660, dur: .12, type: "square", vol: .05 })),
  go: () => play(c => tone(c, { f: 990, dur: .28, type: "square", vol: .06 })),
  /** Low on time. */
  tick: () => play(c => tone(c, { f: 1250, dur: .045, type: "square", vol: .035 })),
  invite: () => play(c => { tone(c, { f: 880, dur: .25, vol: .13 }); tone(c, { f: 1318.5, at: .12, dur: .45, vol: .13 }); }),
  error: () => play(c => tone(c, { f: 150, dur: .22, type: "sawtooth", vol: .07 })),
};
