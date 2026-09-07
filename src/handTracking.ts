import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

// All model/wasm assets are self-hosted under /public (copied from the
// npm package + Google's model bucket at build time) so the app has no
// runtime dependency on an external CDN once deployed.
const WASM_BASE = `${import.meta.env.BASE_URL}wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/hand_landmarker.task`;

export type Landmark = { x: number; y: number; z: number };

// thumb, index, middle, ring, pinky — tip / pip(or thumb-IP) / mcp indices,
// in MediaPipe's 21-point hand landmark scheme.
export const FINGER_TIPS = [4, 8, 12, 16, 20];
const FINGER_PIPS = [3, 6, 10, 14, 18];
export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

// Bone pairs for drawing the full hand skeleton.
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

export interface Hand {
  landmarks: Landmark[];
  pinch: number; // 0 = fingers apart, 1 = fully pinched (thumb + index)
  fingers: boolean[]; // extension state, indexed like FINGER_TIPS: [thumb, index, middle, ring, pinky]
  fingerCount: number; // how many of the 5 are extended
}

let landmarker: HandLandmarker | null = null;

export async function loadHandLandmarker(): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
  });
}

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Pinch strength: distance between thumb tip (4) and index tip (8),
// normalized by palm size (wrist 0 -> middle-finger MCP 9) so it stays
// consistent whether the hand is close to or far from the camera.
function pinchStrength(lm: Landmark[]): number {
  const pinchDist = dist(lm[4], lm[8]);
  const palmSize = dist(lm[0], lm[9]) || 0.001;
  const ratio = pinchDist / palmSize;
  // ratio ~0.2 when pinched, ~1.1+ when open
  const strength = 1 - (ratio - 0.2) / 0.9;
  return Math.min(1, Math.max(0, strength));
}

// A finger counts as extended when its tip sits farther from the wrist
// than its own pip joint does — self-normalizing across hand size and
// distance from the camera. The thumb moves sideways rather than up, so
// it's judged by how far it's splayed from the pinky-side of the palm.
function fingerExtension(lm: Landmark[]): boolean[] {
  const wrist = lm[0];
  const thumbSpread = dist(lm[4], lm[17]);
  const thumbBase = dist(lm[2], lm[17]);
  const thumb = thumbSpread > thumbBase * 1.15;
  const rest = [1, 2, 3, 4].map((i) => dist(wrist, lm[FINGER_TIPS[i]]) > dist(wrist, lm[FINGER_PIPS[i]]) * 1.1);
  return [thumb, ...rest];
}

export function detectHands(video: HTMLVideoElement, timestampMs: number): Hand[] {
  if (!landmarker) return [];
  const result: HandLandmarkerResult = landmarker.detectForVideo(video, timestampMs);
  return result.landmarks.map((lm) => {
    const fingers = fingerExtension(lm);
    return {
      landmarks: lm,
      pinch: pinchStrength(lm),
      fingers,
      fingerCount: fingers.filter(Boolean).length,
    };
  });
}
