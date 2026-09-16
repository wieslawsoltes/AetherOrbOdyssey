# Validation record — 2026-09-16

## Executed successfully

- JavaScript syntax checks: `node --check` on all six source modules.
- Python syntax checks on the build, music-download, local-server, capture and test tools.
- Four deterministic Node tests: the timeline at dense sample intervals, shot boundary consistency, orthonormal camera bases, and portrait reframing.
- Actual Chromium rendering of the generated single-file edition, in a 1280 × 720 viewport: gate plus all eight authored shots. The final runs reported zero WebGL or shader errors.
- Actual browser controls: quality selection, chapter seeking, credits dialog, play/pause, stable paused time, mute, and correct renderer labelling.
- Audio-clock transport and MediaRecorder exercised with an injected low-volume synthetic PCM **test fixture only**. A nonempty video/audio container was produced and then discarded. The fixture is not the film soundtrack and is not distributed as an asset.
- Actual 450 × 800 portrait screenshot and horizontal overflow check.

Machine-readable results are in `tests/browser-results.json`. The images in `previews/` are actual rendered frames, not concept illustrations or pre-rendered images used by the runtime.

## What was not validated here

**Native WebGPU pipeline execution:** the available managed browser could not navigate to a secure local origin. In-memory `about:blank` documents did not expose `navigator.gpu`. Browser GPU checks therefore used the clearly labelled WebGL2 compatibility renderer through Chromium/SwiftShader; this is not a claim of native WebGPU validation. The native implementation includes shader-compilation checks, asynchronous pipeline creation, error events, adapter/device diagnostics, and visible device-loss handling. Its first run on a normal secure origin remains a required native-path check.

**Default-recording playback:** the public source page, license, duration and documented hash were read, but the environment could not download the recording bytes. The archive consequently does not bundle audio, and playback of that particular recording could not be tested end-to-end here. The local downloader, browser network path and fallback UI are supplied; external hosting availability and the user's connectivity still matter.

**Performance on the user's hardware:** no M3 Pro, discrete GPU, mobile hardware or thermal/performance test was executed. Quality presets are workload limits, not validated frame-rate figures.

**Complete video export:** the browser recorder created a nonempty short test container; a full 86-second take with the default score, codec quality, A/V synchronization over the full take and the optional FFmpeg workflow were not reviewed end-to-end. The deterministic capture tool is provided for reproducible offline production, not presented as an already-rendered video.

## Reproduce local checks

```sh
npm test
python3 tools/build_compat.py
python3 tools/build_single.py
```

On Linux with Chromium, Playwright, Xvfb and SwiftShader available, `tests/browser_smoke.py` performs in-memory compatibility testing. Its Chromium executable path and software-renderer flags are intentionally test-machine-specific; adapt them for another development machine. Do not use its software-renderer results as a GPU hardware benchmark.

For native validation, serve the app on localhost and inspect **Credits → Renderer diagnostics**. The backend must read **Native WebGPU / WGSL**, shader errors must be empty, and a complete play-through should cover pause/resume, seek, fullscreen, quality changes and local recording. Only that run verifies the native path on the target device.
