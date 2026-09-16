# Aether Orb — Odyssey

A rebuilt 86.06-second HTML / JavaScript / WebGPU concept film for **CrystalBall**. This is a new implementation, not a modification of the earlier 43-second shader promo.

## GitHub Pages publication

[Watch on GitHub Pages](https://wieslawsoltes.github.io/AetherOrbOdyssey/) · [Deployment status](https://github.com/wieslawsoltes/AetherOrbOdyssey/actions/workflows/pages.yml)

Source: **[wieslawsoltes/AetherOrbOdyssey](https://github.com/wieslawsoltes/AetherOrbOdyssey)**.
Every successful `main` deployment publishes the exact commit and verified runtime asset hashes in `deployment.json`.

The source package includes a complete GitHub Pages workflow, source-integrity verification,
same-origin soundtrack packaging and a safe local publication helper:

```sh
bash tools/publish-github.sh
```

This command requires an authenticated local GitHub CLI, Git, Python 3.10+ and Node.js 20+.
It validates, pushes without force, configures Pages, watches the deployment and verifies the
published revision. The source has been imported through the connected GitHub account; the workflow is the
authoritative deployment status. See [the publication guide](docs/PUBLISHING.md) for prerequisites and checks.

The workflow downloads the credited recording into the published Pages artifact. The source
ZIP still does not contain its bytes. Missing or unverified music fails production publication.

## Watch

```sh
cd AetherOrbOdyssey
python3 tools/serve.py --fetch-music
```

Open **http://localhost:8080**, then press **Watch the film**. Python is only the static development server. There is no backend application, API key, account, JavaScript dependency installation or build step required for playback.

`--fetch-music` downloads the credited recording once, verifies its documented SHA-1 and size, and places it in `assets/zarathustra.ogg`. Without that option the browser first checks for the local file, then downloads the same recording from Wikimedia Commons on the first explicit play. A network connection is required for that first download; subsequent local playback is offline. The source repository does **not** contain the recording bytes. The Pages build downloads, verifies and bundles the recording in the public site, so visitors do not depend on a cross-origin music request.

**Aether-Orb-Odyssey.html** is also a single-file edition: all first-party JavaScript, CSS, WGSL and compatibility GLSL are embedded. Its music is still loaded separately. Use the local server for the most predictable WebGPU behavior. Native WebGPU requires a supporting browser, an available adapter, and a secure context. The app never identifies its compatibility renderer as WebGPU.

## The new film

| Time | Shot | Motion and composition |
| --- | --- | --- |
| 00–14 | Dawn | Planet, moon and sun alignment; a slow rising solar reveal |
| 14–24 | First light | A close moving camera on the refractive glass sphere |
| 24–34 | Material | Low-angle lateral macro across the machined base and emitter |
| 34–47 | Presence | Full product orbit with left-aligned, clipped-reveal typography |
| 47–57 | Inner universe | The camera enters the luminous volume and particle field |
| 57–69 | Architecture | A separating concept assembly, viewed in three dimensions |
| 69–78 | Arrival | Parts settle and the camera pulls out to the product reveal |
| 78–86 | Aether Orb | Closing product shot, brand line and project link |

This is a **concept visualization**. The glass, internal light, circuitry and exploded layers are original illustrative geometry, not a render of a verified production CAD assembly. Copy deliberately avoids manufacturing readiness, shipping dates, specifications, privacy claims and certification claims.

## Rendering

Native render graph:

```text
Absolute film time + camera + music envelope
       ├─ compute: deterministic orbital particle positions
       └─ fragment: analytic sphere/refraction + SDF metal/base + volume march
                              ↓
                         rgba16float HDR
                              ↓
                       additive particles
                              ↓
                   four-level bloom pyramid
                              ↓
                  tone mapping / lens / grain
                              ↓
                  swap-chain + DOM typography
```

The sphere has entry and exit refraction, Fresnel reflection, absorption, studio reflections and a volumetric interior. The base is traced as beveled signed-distance solids with a generated engraved wordmark. The floor receives a secondary product reflection. These are artistic real-time approximations, not a spectral path tracer or an optically validated hardware model.

Particles are time-addressable rather than advanced by accumulated frame deltas. A seek therefore returns directly to a defined state. The score's AudioContext clock is the master while playing. Scene changes follow the authored edit, not beat detection. Modest light-energy modulation comes from a decoded RMS envelope.

The WebGL2 compatibility renderer uses the same authored scene mathematics and equivalent HDR post-processing. Its particles are evaluated by the vertex shader rather than a compute stage. `?compat=1` selects it explicitly. When `navigator.gpu` is absent the compatibility backend is selected automatically; an available-but-failing native adapter produces a visible error and an explicit compatibility choice.

| Quality | Default pixel ceiling | Volume samples | Particles |
| --- | ---: | ---: | ---: |
| Preview | 580,000 | 20 | 4,096 |
| Balanced | 1,300,000 | 32 | 12,288 |
| Cinema | 2,100,000 | 46 | 24,576 |
| Ultra | 8,300,000 | 52 | 32,768 |

These are quality budgets, **not measured frame-rate guarantees**. Ultra allows approximately a 4K render surface; it does not promise real-time 4K playback. Explicit capture dimensions override the default pixel ceiling. Rendering submits one completed frame at a time, avoiding an ever-growing GPU queue.

## Music

**Richard Strauss — Also Sprach Zarathustra, Einleitung**, recording by **Kevin MacLeod**, under **Creative Commons Attribution 3.0**. This is a recording of the requested Strauss introduction, not a Web Audio oscillator imitation and not the commercial film soundtrack master. Attribution, source, license and synchronization notice are included in `NOTICE.md` and the in-app Credits panel.

An unavailable recording triggers a visible error with Retry, Choose audio, and an explicit silent-preview option. Local replacement audio is never uploaded. Replacement audio has its own rights and attribution requirements; the default recording's license does not license a different file.

## Controls

**Space** play/pause · **R** replay · **← / →** seek five seconds · **M** mute · **F** fullscreen · **C** credits. The timeline and chapter menu support direct seeking. Playback never starts automatically, and pauses when the page becomes hidden. Portrait layouts receive a different camera framing and type layout.

## Recording

**Credits → Record film** uses the browser's MediaRecorder, capturing live scene frames, re-composited titles, and audio. It records at the current render dimensions in real time. Codec support and available GPU performance affect the result. Keep the tab visible and avoid seeking or opening other applications during a take.

For frame-by-frame export independent of render speed:

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tools/fetch_music.py
python3 tools/capture.py --width 1920 --height 1080 --fps 30 --mp4 Aether-Orb-Odyssey.mp4
```

The capture tool starts its own local server, checks renderer errors, saves every PNG including DOM typography, and optionally uses an installed FFmpeg to mux the local score. It also writes an accompanying credits file. Use `--visible` for browsers requiring a visible GPU window, `--browser /absolute/path/to/chromium` for a particular executable, and `--compat` only when deliberately selecting the compatibility backend. The MP4 capture workflow was not executed end-to-end in the restricted build environment; see `QA.md`.

A scriptable in-page interface is available:

```js
await window.__film.ready;
await window.__film.frame(39.5, { width: 1920, height: 1080, quality: 'cinema' });
console.log(window.__film.state);
```

`png()` captures the scene canvas only. For typography-inclusive images use a screenshot or the provided capture tool. Native canvas readback for arbitrary `toDataURL()` timing is browser-dependent; the recorder composites frames immediately after rendering.

## Source

- `src/director.js`: shots, camera curves, cuts and typography cues.
- `src/renderer.js`: native WebGPU resource and render-pass management.
- `shaders/*.wgsl`: geometry, optics, volume, particles and post-processing.
- `src/compatibility.js`: explicitly labelled WebGL2 renderer.
- `src/audio.js`: actual recording, cache, audio clock, seeking and local replacement.
- `src/export.js`: local video compositor and recorder.
- `src/app.js`: playback state, UI, error handling and deterministic frame interface.
- `tools/build_compat.py`: deliberately limited translator for this project's shared scene math; not a general WGSL compiler.
- `tools/build_single.py`: the self-contained visual runtime build.
- `tools/fetch_music.py`: documented-file integrity check and local music install.

```sh
npm test
python3 tools/build_compat.py
python3 tools/build_single.py
```

No font files, copyrighted movie frames, commercial soundtrack master, analytics or tracking are included.

## Import and verification provenance

All 42 original text files were transferred with SHA-256 verification. The exact textual baseline is retained in `docs/source-baseline.tar.xz`; subsequent publication edits are separate Git commits. Preview PNGs and the contact sheet were recaptured in GitHub Actions rather than transferred as the original image bytes. This repository uses a new import history, not the earlier local history bundle.

See [import provenance](docs/IMPORT-PROVENANCE.md), [current browser results](tests/browser-results.json), and the [Actions runs](https://github.com/wieslawsoltes/AetherOrbOdyssey/actions). The original `QA.md` and `docs/PUBLICATION-QA.md` describe earlier local validation, not the status of the live deployment. Browser regression checks use the labelled WebGL2 compatibility renderer; they do not claim native WebGPU or physical-device performance validation.
