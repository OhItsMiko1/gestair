import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

// All model/wasm assets are self-hosted under /public (copied from the
// npm package + Google's model bucket at build time) so the app has no
// runtime dependency on an external CDN once deployed.
const WASM_BASE = `${import.meta.env.BASE_URL}wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/hand_landmarker.task`;

export interface Hand {
  landmarks: { x: number; y: number; z: number }[];
  pinch: number; // 0 = fingers apart, 1 = fully pinched
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

// Pinch strength: distance between thumb tip (4) and index tip (8),
// normalized by palm size (wrist 0 -> middle-finger MCP 9) so it stays
// consistent whether the hand is close to or far from the camera.
function pinchStrength(lm: HandLandmarkerResult['landmarks'][number]): number {
  const dx = lm[4].x - lm[8].x;
  const dy = lm[4].y - lm[8].y;
  const pinchDist = Math.hypot(dx, dy);
  const palmDx = lm[0].x - lm[9].x;
  const palmDy = lm[0].y - lm[9].y;
  const palmSize = Math.hypot(palmDx, palmDy) || 0.001;
  const ratio = pinchDist / palmSize;
  // ratio ~0.2 when pinched, ~1.1+ when open
  const strength = 1 - (ratio - 0.2) / 0.9;
  return Math.min(1, Math.max(0, strength));
}

export function detectHands(video: HTMLVideoElement, timestampMs: number): Hand[] {
  if (!landmarker) return [];
  const result = landmarker.detectForVideo(video, timestampMs);
  return result.landmarks.map((lm) => ({
    landmarks: lm,
    pinch: pinchStrength(lm),
  }));
}
