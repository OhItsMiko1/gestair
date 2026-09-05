// Shared Web Audio engine: a plucked-percussion voice for the Grid mode,
// a sustained voice for Air Piano, and a continuous glide voice for Theremin.

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

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

export function ensureAudio(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const compressor = audioCtx.createDynamicsCompressor();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function pluck(freq: number): void {
  const ctx = ensureAudio();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.14, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);

  osc.connect(g).connect(masterGain!);
  osc2.connect(g2).connect(masterGain!);
  osc.start(t);
  osc.stop(t + 0.95);
  osc2.start(t);
  osc2.stop(t + 0.45);
}

export interface SustainVoice {
  stop(release?: number): void;
}

export function startPianoVoice(freq: number): SustainVoice {
  const ctx = ensureAudio();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.4, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.3);
  osc.connect(g).connect(masterGain!);
  osc.start(t);
  return {
    stop(release = 0.15) {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + release);
      osc.stop(now + release + 0.02);
    },
  };
}

export interface ThereminVoice {
  update(freq: number, cutoff: number): void;
  stop(): void;
}

export function startTheremin(freq: number, cutoff: number): ThereminVoice {
  const ctx = ensureAudio();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  filter.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.3, t + 0.06);
  osc.connect(filter).connect(g).connect(masterGain!);
  osc.start(t);
  return {
    update(freq, cutoff) {
      const now = ctx.currentTime;
      osc.frequency.setTargetAtTime(freq, now, 0.03);
      filter.frequency.setTargetAtTime(cutoff, now, 0.05);
    },
    stop() {
      const now = ctx.currentTime;
      g.gain.setTargetAtTime(0, now, 0.08);
      osc.stop(now + 0.4);
    },
  };
}
