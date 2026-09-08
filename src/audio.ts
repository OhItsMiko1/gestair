// Shared Web Audio engine: a bank of melodic synth patches usable as a
// one-shot pluck (Grid), a sustained voice (Air Piano) or a continuous
// glide voice (Theremin); a synthesized drum kit for Grid mode; and a
// recorder that taps the master bus for download or in-app loop playback.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number): string {
  const n = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${n}${octave}`;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Major pentatonic, ascending across the grid: low notes bottom-left,
// high notes top-right, the way real pitched percussion is laid out.
const PENTA = [0, 2, 4, 7, 9];
export const GRID_NOTES: number[] = Array.from({ length: 16 }, (_, i) => {
  const octave = Math.floor(i / 5);
  const degree = i % 5;
  return 60 + 12 * octave + PENTA[degree];
});

// Diatonic C major across the air-piano keys.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const PIANO_NOTES: number[] = Array.from({ length: 12 }, (_, i) => {
  const octave = Math.floor(i / 7);
  const degree = i % 7;
  return 60 + 12 * octave + MAJOR[degree];
});

// ---------------- core audio graph ----------------

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let busOut: DynamicsCompressorNode | null = null;
let recordDest: MediaStreamAudioDestinationNode | null = null;

// A short synthetic room impulse (exponentially decaying noise) — no
// sample file needed, just enough tail to keep every patch from sounding
// like it's playing in a vacuum.
function buildImpulseResponse(ctx: AudioContext, seconds = 2.0, decay = 3.4): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export function ensureAudio(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.connect(audioCtx.destination);
    busOut = compressor;

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.85;
    masterGain.connect(compressor);

    // Master reverb send — a bit of room on everything is most of what
    // separates a "produced" sound from a bare oscillator.
    const reverb = audioCtx.createConvolver();
    reverb.buffer = buildImpulseResponse(audioCtx);
    const reverbSend = audioCtx.createGain();
    reverbSend.gain.value = 0.15;
    masterGain.connect(reverbSend);
    reverbSend.connect(reverb);
    reverb.connect(compressor);

    // A subtle slap-delay send adds rhythmic depth without muddying pads.
    const delay = audioCtx.createDelay(1.0);
    delay.delayTime.value = 0.17;
    const delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.22;
    const delayFilter = audioCtx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 3200;
    const delaySend = audioCtx.createGain();
    delaySend.gain.value = 0.1;
    masterGain.connect(delaySend);
    delaySend.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delay);
    delayFilter.connect(compressor);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ---------------- melodic synth patches ----------------

export type MelodicSynth = 'saw' | 'pad' | 'sine' | 'square' | 'organ';

export const MELODIC_SYNTHS: MelodicSynth[] = ['saw', 'pad', 'sine', 'square', 'organ'];

export const SYNTH_LABELS: Record<MelodicSynth, string> = {
  saw: 'Saw Lead',
  pad: 'Warm Pad',
  sine: 'Sine',
  square: 'Square Bass',
  organ: 'Organ',
};

interface VoiceOsc {
  node: OscillatorNode;
  ratio: number; // multiple of the played frequency, so chords/harmonics track pitch changes
}

interface VoiceGraph {
  oscillators: VoiceOsc[];
  filter: BiquadFilterNode | null;
  out: AudioNode;
}

function buildGraph(ctx: AudioContext, freq: number, synth: MelodicSynth): VoiceGraph {
  const mix = ctx.createGain();
  mix.gain.value = 1;

  switch (synth) {
    case 'saw': {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2600;
      filter.Q.value = 1.2;
      osc.connect(filter).connect(mix);
      return { oscillators: [{ node: osc, ratio: 1 }], filter, out: mix };
    }
    case 'pad': {
      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.value = freq;
      oscA.detune.value = -7;
      const oscB = ctx.createOscillator();
      oscB.type = 'sawtooth';
      oscB.frequency.value = freq;
      oscB.detune.value = 7;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1500;
      filter.Q.value = 0.7;
      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(mix);
      return {
        oscillators: [
          { node: oscA, ratio: 1 },
          { node: oscB, ratio: 1 },
        ],
        filter,
        out: mix,
      };
    }
    case 'sine': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(mix);
      return { oscillators: [{ node: osc, ratio: 1 }], filter: null, out: mix };
    }
    case 'square': {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      filter.Q.value = 2.5;
      osc.connect(filter).connect(mix);
      return { oscillators: [{ node: osc, ratio: 1 }], filter, out: mix };
    }
    case 'organ': {
      const ratios = [1, 2, 3, 4];
      const gains = [1, 0.5, 0.32, 0.2];
      const oscillators: VoiceOsc[] = ratios.map((ratio, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * ratio;
        const g = ctx.createGain();
        g.gain.value = gains[i];
        osc.connect(g).connect(mix);
        return { node: osc, ratio };
      });
      return { oscillators, filter: null, out: mix };
    }
  }
}

export function pluck(freq: number, synth: MelodicSynth = 'saw'): void {
  const ctx = ensureAudio();
  const t = ctx.currentTime;
  const { oscillators, out } = buildGraph(ctx, freq, synth);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.55, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  out.connect(g).connect(masterGain!);
  oscillators.forEach(({ node }) => {
    node.start(t);
    node.stop(t + 0.95);
  });
}

export interface SustainVoice {
  stop(release?: number): void;
}

export function startSustainVoice(freq: number, synth: MelodicSynth = 'saw'): SustainVoice {
  const ctx = ensureAudio();
  const t = ctx.currentTime;
  const { oscillators, out } = buildGraph(ctx, freq, synth);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.4, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.35);
  out.connect(g).connect(masterGain!);
  oscillators.forEach(({ node }) => node.start(t));
  return {
    stop(release = 0.18) {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + release);
      oscillators.forEach(({ node }) => node.stop(now + release + 0.02));
    },
  };
}

export interface ThereminVoice {
  update(freq: number, cutoff: number): void;
  stop(): void;
}

export function startTheremin(freq: number, cutoff: number, synth: MelodicSynth = 'saw'): ThereminVoice {
  const ctx = ensureAudio();
  const t = ctx.currentTime;
  const { oscillators, filter, out } = buildGraph(ctx, freq, synth);
  if (filter) filter.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.3, t + 0.06);
  out.connect(g).connect(masterGain!);
  oscillators.forEach(({ node }) => node.start(t));
  return {
    update(freq, cutoff) {
      const now = ctx.currentTime;
      oscillators.forEach(({ node, ratio }) => node.frequency.setTargetAtTime(freq * ratio, now, 0.03));
      if (filter) filter.frequency.setTargetAtTime(cutoff, now, 0.05);
    },
    stop() {
      const now = ctx.currentTime;
      g.gain.setTargetAtTime(0, now, 0.08);
      oscillators.forEach(({ node }) => node.stop(now + 0.4));
    },
  };
}

// ---------------- drum kit ----------------

export type DrumId =
  | 'kick'
  | 'kick2'
  | 'snare'
  | 'rim'
  | 'hatClosed'
  | 'hatOpen'
  | 'clap'
  | 'tomLo'
  | 'tomMid'
  | 'tomHi'
  | 'crash'
  | 'ride'
  | 'cowbell'
  | 'clave'
  | 'shaker'
  | 'perc';

// Laid out to fill the 4x4 grid the way a drum machine pad bank would:
// kicks/snares/hats up front, toms and cymbals, then percussion.
export const DRUM_PADS: DrumId[] = [
  'kick',
  'kick2',
  'snare',
  'rim',
  'hatClosed',
  'hatOpen',
  'clap',
  'perc',
  'tomLo',
  'tomMid',
  'tomHi',
  'clave',
  'crash',
  'ride',
  'cowbell',
  'shaker',
];

export const DRUM_LABELS: Record<DrumId, string> = {
  kick: 'Kick',
  kick2: 'Kick 2',
  snare: 'Snare',
  rim: 'Rim',
  hatClosed: 'Hat',
  hatOpen: 'Open Hat',
  clap: 'Clap',
  perc: 'Perc',
  tomLo: 'Tom Lo',
  tomMid: 'Tom Mid',
  tomHi: 'Tom Hi',
  clave: 'Clave',
  crash: 'Crash',
  ride: 'Ride',
  cowbell: 'Cowbell',
  shaker: 'Shaker',
};

let noiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const length = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function noiseBurst(ctx: AudioContext, t: number, decay: number, filterType: BiquadFilterType, freq: number, q = 1, peak = 0.6) {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(filter).connect(g).connect(masterGain!);
  src.start(t);
  src.stop(t + decay + 0.02);
}

function tonePunch(ctx: AudioContext, t: number, startFreq: number, endFreq: number, decay: number, type: OscillatorType = 'sine', peak = 0.9) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t + decay * 0.9);
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(g).connect(masterGain!);
  osc.start(t);
  osc.stop(t + decay + 0.02);
}

export function playDrum(id: DrumId): void {
  const ctx = ensureAudio();
  const t = ctx.currentTime;
  switch (id) {
    case 'kick':
      tonePunch(ctx, t, 150, 42, 0.32);
      noiseBurst(ctx, t, 0.02, 'lowpass', 800, 1, 0.3);
      break;
    case 'kick2':
      tonePunch(ctx, t, 210, 55, 0.24, 'triangle', 0.85);
      noiseBurst(ctx, t, 0.015, 'lowpass', 1200, 1, 0.35);
      break;
    case 'snare':
      noiseBurst(ctx, t, 0.16, 'highpass', 1400, 0.8, 0.55);
      tonePunch(ctx, t, 190, 140, 0.1, 'triangle', 0.35);
      break;
    case 'rim':
      tonePunch(ctx, t, 1600, 900, 0.05, 'square', 0.25);
      break;
    case 'hatClosed':
      noiseBurst(ctx, t, 0.045, 'highpass', 7500, 0.7, 0.32);
      break;
    case 'hatOpen':
      noiseBurst(ctx, t, 0.3, 'highpass', 7000, 0.7, 0.3);
      break;
    case 'clap':
      [0, 0.012, 0.024].forEach((d) => noiseBurst(ctx, t + d, 0.18, 'bandpass', 1200, 1.2, 0.4));
      break;
    case 'perc':
      tonePunch(ctx, t, 900, 500, 0.09, 'sine', 0.4);
      break;
    case 'tomLo':
      tonePunch(ctx, t, 150, 90, 0.32, 'sine', 0.8);
      break;
    case 'tomMid':
      tonePunch(ctx, t, 210, 130, 0.28, 'sine', 0.8);
      break;
    case 'tomHi':
      tonePunch(ctx, t, 300, 190, 0.24, 'sine', 0.8);
      break;
    case 'clave':
      tonePunch(ctx, t, 2500, 2200, 0.05, 'sine', 0.5);
      break;
    case 'crash':
      noiseBurst(ctx, t, 1.4, 'highpass', 5500, 0.5, 0.35);
      break;
    case 'ride':
      noiseBurst(ctx, t, 0.6, 'bandpass', 6500, 4, 0.25);
      break;
    case 'cowbell': {
      [587, 845].forEach((f) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = f;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = f;
        filter.Q.value = 3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        osc.connect(filter).connect(g).connect(masterGain!);
        osc.start(t);
        osc.stop(t + 0.32);
      });
      break;
    }
    case 'shaker':
      noiseBurst(ctx, t, 0.08, 'bandpass', 6000, 1.5, 0.3);
      break;
  }
}

// ---------------- recording ----------------

export interface Recorder {
  start(): void;
  stop(): Promise<Blob>;
  isRecording(): boolean;
}

export function createRecorder(): Recorder {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let recording = false;

  return {
    start() {
      const ctx = ensureAudio();
      if (!recordDest) {
        recordDest = ctx.createMediaStreamDestination();
        busOut!.connect(recordDest);
      }
      chunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      mediaRecorder = mimeType ? new MediaRecorder(recordDest.stream, { mimeType }) : new MediaRecorder(recordDest.stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.start();
      recording = true;
    },
    stop() {
      return new Promise<Blob>((resolve) => {
        if (!mediaRecorder) {
          resolve(new Blob());
          return;
        }
        mediaRecorder.onstop = () => {
          recording = false;
          resolve(new Blob(chunks, { type: mediaRecorder!.mimeType || 'audio/webm' }));
        };
        mediaRecorder.stop();
      });
    },
    isRecording() {
      return recording;
    },
  };
}
