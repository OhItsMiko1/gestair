import './style.css';
import {
  ensureAudio,
  pluck,
  startSustainVoice,
  startTheremin,
  noteName,
  midiToFreq,
  GRID_NOTES,
  PIANO_NOTES,
  MELODIC_SYNTHS,
  SYNTH_LABELS,
  DRUM_PADS,
  DRUM_LABELS,
  playDrum,
  createRecorder,
  type MelodicSynth,
  type SustainVoice,
  type ThereminVoice,
} from './audio';
import { loadHandLandmarker, startCamera, detectHands, type Hand } from './handTracking';

type ModeId = 'theremin' | 'grid' | 'piano';
type GridSynth = MelodicSynth | 'drums';

const HINTS: Record<ModeId, string> = {
  theremin: 'Hold up one hand — height bends pitch, side-to-side shapes the tone. Lower your hand to go silent.',
  grid: 'Point with one or two hands and cross into a pad to play it, like tapping a drum pad in the air.',
  piano: 'Pinch thumb and index finger to press a key, slide while pinched to glide between notes.',
};

const app = document.getElementById('app')!;
const stage = document.getElementById('stage')!;
const video = document.getElementById('video') as HTMLVideoElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const ctx = overlay.getContext('2d')!;
const gate = document.getElementById('gate')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const gateStatus = document.getElementById('gate-status')!;
const noteBox = document.getElementById('readout-note')!;
const hintBox = document.getElementById('readout-hint')!;
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
const synthSelect = document.getElementById('synth-select') as HTMLSelectElement;
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const loopBtn = document.getElementById('loop-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const transportStatus = document.getElementById('transport-status')!;

const PALETTE: Record<ModeId, string> = {
  theremin: '#ff9b4d',
  grid: '#4fe0b0',
  piano: '#7fb2ff',
};

function setReadout(text: string, hint?: string) {
  noteBox.innerHTML = text;
  if (hint !== undefined) hintBox.textContent = hint;
}

function mirroredPoint(lm: { x: number; y: number }, w: number, h: number) {
  return { x: (1 - lm.x) * w, y: lm.y * h };
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------------- per-mode sound selection ----------------

const GRID_SYNTH_OPTIONS: GridSynth[] = [...MELODIC_SYNTHS, 'drums'];
const SYNTH_OPTION_LABELS: Record<GridSynth, string> = { ...SYNTH_LABELS, drums: 'Drum Kit' };

const modeSynth: Record<ModeId, GridSynth> = {
  theremin: 'saw',
  grid: 'drums',
  piano: 'organ',
};

function synthOptionsFor(m: ModeId): GridSynth[] {
  return m === 'grid' ? GRID_SYNTH_OPTIONS : MELODIC_SYNTHS;
}

function populateSynthSelect() {
  const options = synthOptionsFor(mode);
  synthSelect.innerHTML = '';
  options.forEach((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = SYNTH_OPTION_LABELS[id];
    synthSelect.appendChild(opt);
  });
  synthSelect.value = modeSynth[mode];
}
synthSelect.addEventListener('change', () => {
  modeSynth[mode] = synthSelect.value as GridSynth;
});

// ---------------- mode controllers ----------------

interface ModeController {
  frame(hands: Hand[], w: number, h: number): void;
  reset(): void;
}

class ThereminMode implements ModeController {
  private voice: ThereminVoice | null = null;
  private voiceSynth: MelodicSynth | null = null;

  frame(hands: Hand[], w: number, h: number): void {
    const synth = modeSynth.theremin as MelodicSynth;

    if (hands.length === 0) {
      this.reset();
      setReadout('&mdash;', HINTS.theremin);
      return;
    }
    const hand = hands[0];
    const palm = mirroredPoint(hand.landmarks[9], w, h);

    ctx.strokeStyle = 'rgba(255,155,77,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(24, 20);
    ctx.lineTo(24, h - 44);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(60, h - 18);
    ctx.lineTo(w - 24, h - 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(233,230,244,0.5)';
    ctx.font = '11px "JetBrains Mono"';
    ctx.fillText('dark', 60, h - 26);
    ctx.fillText('bright', w - 60, h - 26);
    [48, 60, 72].forEach((midi) => {
      const frac = (midi - 48) / 24;
      const y = h - 44 - frac * (h - 64);
      ctx.fillText(noteName(midi), 34, y + 4);
    });

    const yFrac = 1 - palm.y / h;
    const midi = 48 + yFrac * 24;
    const freq = midiToFreq(midi);
    const xFrac = Math.min(Math.max(palm.x / w, 0), 1);
    const cutoff = 250 + xFrac * 4200;

    if (this.voice && this.voiceSynth !== synth) {
      this.voice.stop();
      this.voice = null;
    }
    if (!this.voice) {
      this.voice = startTheremin(freq, cutoff, synth);
      this.voiceSynth = synth;
    } else {
      this.voice.update(freq, cutoff);
    }

    ctx.beginPath();
    const grad = ctx.createRadialGradient(palm.x, palm.y, 2, palm.x, palm.y, 22);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.5, PALETTE.theremin);
    grad.addColorStop(1, 'rgba(255,155,77,0)');
    ctx.fillStyle = grad;
    ctx.arc(palm.x, palm.y, 22, 0, Math.PI * 2);
    ctx.fill();

    setReadout(`${noteName(Math.round(midi))} <span class="hz">${freq.toFixed(1)} Hz</span>`);
  }

  reset(): void {
    if (this.voice) {
      this.voice.stop();
      this.voice = null;
      this.voiceSynth = null;
    }
  }
}

const GRID_PAD = 14;
class GridMode implements ModeController {
  private lastCell: (number | null)[] = [null, null];
  private flashes = new Map<number, number>();

  private rect(w: number, h: number) {
    return { x: GRID_PAD, y: GRID_PAD, w: w - GRID_PAD * 2, h: h - GRID_PAD * 2 };
  }

  frame(hands: Hand[], w: number, h: number): void {
    const synth = modeSynth.grid;
    const isDrums = synth === 'drums';
    const r = this.rect(w, h);
    const now = performance.now();

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const index = (3 - row) * 4 + col;
        const cx = r.x + (col * r.w) / 4;
        const cy = r.y + (row * r.h) / 4;
        const cw = r.w / 4 - 8;
        const ch = r.h / 4 - 8;
        const flashUntil = this.flashes.get(index) ?? 0;
        const on = now < flashUntil;
        ctx.fillStyle = on ? 'rgba(79,224,176,0.28)' : 'rgba(255,255,255,0.04)';
        ctx.strokeStyle = on ? PALETTE.grid : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = on ? 2 : 1;
        roundRect(ctx, cx + 4, cy + 4, cw, ch, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = on ? '#eafff6' : 'rgba(233,230,244,0.45)';
        ctx.font = '11px "JetBrains Mono"';
        const label = isDrums ? DRUM_LABELS[DRUM_PADS[index]] : noteName(GRID_NOTES[index]);
        ctx.fillText(label, cx + 12, cy + ch - 6);
      }
    }

    let readoutSet = false;
    for (let i = 0; i < 2; i++) {
      const hand = hands[i];
      if (!hand) {
        this.lastCell[i] = null;
        continue;
      }
      const p = mirroredPoint(hand.landmarks[8], w, h);
      ctx.beginPath();
      ctx.fillStyle = PALETTE.grid;
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.fill();

      if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) {
        this.lastCell[i] = null;
        continue;
      }
      const col = Math.min(3, Math.floor(((p.x - r.x) / r.w) * 4));
      const row = Math.min(3, Math.floor(((p.y - r.y) / r.h) * 4));
      const index = (3 - row) * 4 + col;
      if (index !== this.lastCell[i]) {
        this.lastCell[i] = index;
        this.flashes.set(index, now + 180);
        if (isDrums) {
          const drum = DRUM_PADS[index];
          playDrum(drum);
          setReadout(DRUM_LABELS[drum]);
        } else {
          const freq = midiToFreq(GRID_NOTES[index]);
          pluck(freq, synth as MelodicSynth);
          setReadout(`${noteName(GRID_NOTES[index])} <span class="hz">${freq.toFixed(1)} Hz</span>`);
        }
        readoutSet = true;
      }
    }
    if (!readoutSet && hands.length === 0) setReadout('&mdash;', HINTS.grid);
  }

  reset(): void {
    this.lastCell = [null, null];
    this.flashes.clear();
  }
}

const PIANO_PAD = 14;
interface PianoSlot {
  pinched: boolean;
  keyIndex: number | null;
  voice: SustainVoice | null;
}
class PianoMode implements ModeController {
  private slots: PianoSlot[] = [
    { pinched: false, keyIndex: null, voice: null },
    { pinched: false, keyIndex: null, voice: null },
  ];

  private rect(w: number, h: number) {
    return { x: PIANO_PAD, y: PIANO_PAD, w: w - PIANO_PAD * 2, h: h - PIANO_PAD * 2 };
  }

  private keyIndexAt(x: number, r: { x: number; w: number }): number {
    const frac = Math.min(Math.max((x - r.x) / r.w, 0), 0.9999);
    return Math.floor(frac * PIANO_NOTES.length);
  }

  private release(slot: PianoSlot) {
    if (slot.voice) slot.voice.stop(0.18);
    slot.pinched = false;
    slot.keyIndex = null;
    slot.voice = null;
  }

  frame(hands: Hand[], w: number, h: number): void {
    const synth = modeSynth.piano as MelodicSynth;
    const r = this.rect(w, h);
    const keyW = r.w / PIANO_NOTES.length;

    for (let i = 0; i < 2; i++) {
      const hand = hands[i];
      const slot = this.slots[i];
      if (!hand) {
        if (slot.pinched) this.release(slot);
        continue;
      }
      const p = mirroredPoint(hand.landmarks[8], w, h);
      const keyIndex = this.keyIndexAt(p.x, r);
      const pinchOn = hand.pinch > (slot.pinched ? 0.4 : 0.6);

      if (pinchOn && !slot.pinched) {
        slot.pinched = true;
        slot.keyIndex = keyIndex;
        slot.voice = startSustainVoice(midiToFreq(PIANO_NOTES[keyIndex]), synth);
        setReadout(
          `${noteName(PIANO_NOTES[keyIndex])} <span class="hz">${midiToFreq(PIANO_NOTES[keyIndex]).toFixed(1)} Hz</span>`
        );
      } else if (pinchOn && slot.pinched && keyIndex !== slot.keyIndex) {
        if (slot.voice) slot.voice.stop(0.06);
        slot.keyIndex = keyIndex;
        slot.voice = startSustainVoice(midiToFreq(PIANO_NOTES[keyIndex]), synth);
        setReadout(
          `${noteName(PIANO_NOTES[keyIndex])} <span class="hz">${midiToFreq(PIANO_NOTES[keyIndex]).toFixed(1)} Hz</span>`
        );
      } else if (!pinchOn && slot.pinched) {
        this.release(slot);
      }
    }

    PIANO_NOTES.forEach((midi, idx) => {
      const active = this.slots.some((s) => s.pinched && s.keyIndex === idx);
      const kx = r.x + idx * keyW;
      ctx.fillStyle = active ? 'rgba(127,178,255,0.32)' : 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = active ? PALETTE.piano : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = active ? 2 : 1;
      roundRect(ctx, kx + 3, r.y, keyW - 6, r.h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? '#eaf3ff' : 'rgba(233,230,244,0.45)';
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillText(noteName(midi), kx + 8, r.y + r.h - 10);
    });

    hands.slice(0, 2).forEach((hand) => {
      const p = mirroredPoint(hand.landmarks[8], w, h);
      const size = 7 + hand.pinch * 8;
      ctx.beginPath();
      ctx.fillStyle = hand.pinch > 0.5 ? PALETTE.piano : 'rgba(255,255,255,0.6)';
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    });

    if (hands.length === 0 && !this.slots.some((s) => s.pinched)) setReadout('&mdash;', HINTS.piano);
  }

  reset(): void {
    this.slots.forEach((s) => this.release(s));
  }
}

const controllers: Record<ModeId, ModeController> = {
  theremin: new ThereminMode(),
  grid: new GridMode(),
  piano: new PianoMode(),
};

let mode: ModeId = 'theremin';
function setMode(next: ModeId) {
  if (next === mode) return;
  controllers[mode].reset();
  mode = next;
  app.dataset.mode = mode;
  tabs.forEach((t) => t.setAttribute('aria-selected', String((t.dataset.mode as ModeId) === mode)));
  setReadout('&mdash;', HINTS[mode]);
  populateSynthSelect();
}
tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode as ModeId)));
setReadout('&mdash;', HINTS[mode]);
populateSynthSelect();

// ---------------- recording ----------------

const recorder = createRecorder();
let takeBlob: Blob | null = null;
let takeUrl: string | null = null;
const playbackAudio = new Audio();
let recordingStartedAt = 0;
let recordTimer: number | null = null;

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

recordBtn.addEventListener('click', () => {
  ensureAudio();
  if (!recorder.isRecording()) {
    recorder.start();
    recordBtn.setAttribute('aria-pressed', 'true');
    recordBtn.lastChild!.textContent = ' Stop';
    playBtn.disabled = true;
    loopBtn.disabled = true;
    downloadBtn.disabled = true;
    recordingStartedAt = performance.now();
    recordTimer = window.setInterval(() => {
      transportStatus.textContent = formatTime(performance.now() - recordingStartedAt);
    }, 200);
  } else {
    recorder.stop().then((blob) => {
      takeBlob = blob;
      if (takeUrl) URL.revokeObjectURL(takeUrl);
      takeUrl = URL.createObjectURL(blob);
      playbackAudio.src = takeUrl;
      playBtn.disabled = false;
      loopBtn.disabled = false;
      downloadBtn.disabled = false;
      transportStatus.textContent = `take ready · ${formatTime(performance.now() - recordingStartedAt)}`;
    });
    recordBtn.setAttribute('aria-pressed', 'false');
    recordBtn.lastChild!.textContent = ' Record';
    if (recordTimer) {
      window.clearInterval(recordTimer);
      recordTimer = null;
    }
  }
});

playBtn.addEventListener('click', () => {
  if (playbackAudio.paused) {
    playbackAudio.play();
    playBtn.textContent = 'Pause';
  } else {
    playbackAudio.pause();
    playBtn.textContent = 'Play';
  }
});
playbackAudio.addEventListener('ended', () => {
  if (!playbackAudio.loop) playBtn.textContent = 'Play';
});

loopBtn.addEventListener('click', () => {
  const next = loopBtn.getAttribute('aria-pressed') !== 'true';
  loopBtn.setAttribute('aria-pressed', String(next));
  playbackAudio.loop = next;
});

downloadBtn.addEventListener('click', () => {
  if (!takeBlob) return;
  const a = document.createElement('a');
  a.href = takeUrl!;
  a.download = `gestair-take-${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// ---------------- camera + render loop ----------------

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(rect.width * dpr);
  overlay.height = Math.round(rect.height * dpr);
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

let running = false;
function loop() {
  if (!running) return;
  const rect = stage.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (video.readyState >= 2) {
    const hands = detectHands(video, performance.now());
    controllers[mode].frame(hands, rect.width, rect.height);
  }
  requestAnimationFrame(loop);
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  gateStatus.classList.remove('error');
  try {
    gateStatus.textContent = 'Loading hand-tracking model…';
    await loadHandLandmarker();
    gateStatus.textContent = 'Requesting camera access…';
    await startCamera(video);
    ensureAudio();
    resizeCanvas();
    gate.setAttribute('hidden', '');
    running = true;
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    gateStatus.classList.add('error');
    gateStatus.textContent =
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Camera permission was denied — allow camera access and try again.'
        : 'Could not start the camera or hand-tracking model. Try reloading the page.';
    startBtn.disabled = false;
  }
});
