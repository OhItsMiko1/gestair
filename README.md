# Gestair

Gesture-controlled instruments that play in your browser tab — no MIDI
controller, no touchscreen, just your webcam and your hand.

Three modes, switchable at the top of the page:

- **Theremin** — hold up a hand; its height bends pitch and its
  side-to-side position shapes the tone's brightness. Lower your hand
  and it goes quiet, like stepping back from a real theremin's antenna.
- **Grid** — a 4×4 pentatonic pad grid. Cross a fingertip into a new
  pad to play it, like tapping an air drum pad.
- **Air Piano** — 12 diatonic keys laid out left to right. Pinch thumb
  and index finger together to press a key, and slide while pinched to
  glide between notes.

All hand tracking runs on-device via [MediaPipe
Tasks](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) —
the model and its WebAssembly runtime are bundled with the app itself
(see `public/models` and `public/wasm`), so no video frame ever leaves
the browser and the app has no runtime dependency on an external CDN.
Sound is synthesized locally with the Web Audio API.

## Play it online

Live at **https://ohitsmiko1.github.io/gestair/** once [GitHub Pages
is enabled](#deployment) for this repo. Needs a browser that supports
`getUserMedia` and Web Audio (any modern desktop or mobile browser) and
a bit of light in the room — the hand-tracking model needs to actually
see your hand.

## Local development

```bash
npm install
npm run dev
```

Open the printed local URL and click **Start playing** to grant camera
access — the browser will not request it until you do, and a modern
browser only allows camera access on `localhost` or HTTPS.

## Build

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally
```

## Deployment

This repo deploys to GitHub Pages automatically via
`.github/workflows/deploy.yml` on every push to `main`. To turn it on
for the first time: **Settings → Pages → Source → GitHub Actions**.
