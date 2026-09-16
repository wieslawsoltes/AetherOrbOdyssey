# Browser recording repair

## Use

Open the deployed film with `?v=recording-3`, open Credits and select Record film.
A visible status panel reports preparation, elapsed film time, dimensions and encoded
bytes. Playback pause/resume also pauses/resumes the recorder. Stop & save finishes
early. At the natural end, the recording finalizes automatically. The persistent
Download WebM/MP4 link works even when an automatic download was blocked. The link
remains valid until another recording starts or the page closes. An automatic
click is not represented as proof the user saved the file.

Capture stays local and requests neither microphone nor screen-recording permission.
Chrome prefers VP8 + Opus in WebM. A `.webm` file is not an MP4: open it in Chrome or
another WebM-capable player. The extension is selected from the actual output MIME.
Recording output resolution is bounded to even dimensions within 1920x1080 (or
1080x1920 portrait) without upscaling. Capture has a 30 fps ceiling, not a guaranteed
30 unique frames per second. Render speed and machine resources still matter.

## Defects addressed

The old WebGPU path awaited GPU completion and only then used drawImage on the
canvas. The presentation texture can have been consumed/recycled by that point.
The renderer now requests COPY_SRC usage and encodes copyTextureToBuffer immediately
after the final grade in the same GPU submission. A mapped staging buffer survives
presentation; rows are unpadded from 256-byte alignment and BGRA is converted to
RGBA. Only then are motion titles composited onto the captured frame. The compatible
WebGL2 renderer already preserves its drawing buffer and retains its direct copy.

The recorder previously selected one advertised codec without constructor/start
fallback, had no startup/finalization timeout, no visible stop/save control, hid
errors inside the closed Credits dialog, automatically revoked the only download
URL, and could leave recording active after soundtrack interruption/end or pause.
The replacement has explicit state, bounded timeouts, owned-track cleanup, final
chunk ordering, a persistent download result, even/capped dimensions, and no
"saved" claim for empty/error output. It prefers the lower-complexity VP8 encoder
before VP9, tries MP4/default where necessary, and surfaces mid-recording errors
rather than silently replacing content or discarding an error as success.

## Validation

`node --test tests/recording.test.mjs` covers row padding, BGRA, dimension limits,
codec fallback, failed and hung encoders, final chunk ordering, repeated recording,
original audio-track ownership and title-free capture frames.

`tests/recording_browser.py` runs the real application (no renderer stub), records
its actual credited MP3, saves via real browser download events, and decodes the
result with FFmpeg. Assertions include both video/audio tracks, decoded frame count,
nonzero audio samples, changing nonblack image pixels, pause/resume, persistent
re-download, second recording, natural end, and an explicitly injected encoder error.

GitHub Pages is gated on native WebGPU/Chromium on Linux and installed Google Chrome
on a macOS runner. Native adapter availability/backend, OS and exact browser version
are included in each report. A hosted macOS runner is not the user's physical Mac;
when native WebGPU is unavailable there, its report explicitly identifies WebGL2.
Local container browser navigation/GPU policy prevented a GPU test; local unit tests
are not reported as a native/physical-device pass. Consult the current Actions run
and its recording evidence artifacts for actual executed results.

## Primary references

- WebGPU canvas lifetime and texture readback: https://www.w3.org/TR/webgpu/
- MediaStream Recording (support is not guaranteed encoder availability; final
  dataavailable precedes stop): https://www.w3.org/TR/mediastream-recording/
- Canvas capture and requestFrame: https://w3c.github.io/mediacapture-fromelement/

## Input-ready ordering

Chrome can delay MediaRecorder's start event until every input track has supplied
media. A repeated capture must start the soundtrack and the render loop before
awaiting recorder.ready; otherwise a stopped previous source can starve the audio
track and the preparation phase times out. The real macOS Chrome regression test
reproduced this condition on a second capture with one video frame and zero bytes.
Both tracks are now primed before waiting for readiness, while startup remains
bounded and failures pause playback and release recording resources.

## Executed macOS recording validation

GitHub Actions run 35133451644, macOS job 104920305061, passed all
recording browser checks with Google Chrome 152.0.7977.65 on macOS
14.8.9 ARM64 and the actual NATIVE WEBGPU renderer. Tests recorded real
film scenes and the credited MP3, then decoded VP8 video and Opus audio.
Checks covered the Record film UI, pause/resume, Stop & save, a byte-identical
manual re-download, a second glass-scene recording with changing nonblack
pixels and nonzero encoded music, natural end finalization, and visible
recovery from an injected asynchronous encoder error. These were 960x540
capture tests on a hosted Mac, not a full-duration 1080p performance test
or a test on the user's own Mac. The source gate also passed 35 JavaScript
and 13 Python tests, plus real-audio Chromium and WebKit checks.

Evidence: https://github.com/wieslawsoltes/AetherOrbOdyssey/actions/runs/35133451644/job/104920305061

The separate Linux SwiftShader native-WebGPU job in that run failed
during renderer initialization, before any recording or audio began:
"A valid external Instance reference no longer exists." This reproduced
with both Chromium 143 and installed Google Chrome 152. It remains an
unresolved Linux native-rendering/driver compatibility limitation; no
Linux native-WebGPU recording success is claimed. The mandatory release
matrix now explicitly requires native WebGPU on macOS Chrome and
independently exercises the WebGL2 compatibility capture path on Linux.
A backend assertion prevents silently passing native tests with fallback.
Neither job suppresses test failures. Both must pass before deployment.
