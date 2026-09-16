# Cinematic WebGPU renderer

The native renderer now compiles an explicit resource-versioned frame graph. It
remains an analytic product renderer, not a deferred mesh engine. A second scene
renderer or a depth prepass would duplicate the most expensive work here.

## Implemented pipeline

`scene HDR + ray distance -> particle compute/raster -> fused bloom pyramid ->
anamorphic glare + half-resolution volumetric shafts -> depth-aware composite,
reconstruction, shockwave, optical ghosts, grade -> presentation / optional capture`

Balanced has 13 logical passes, including compute. Dawn skips particle execution.
The previous native stack had 16 passes in product shots. Bloom uses four fused
downsample/filter passes and three tent upsample passes, instead of four sets of
separate downsample, horizontal blur and vertical blur passes. All optics stay in
linear RGBA16F until the final filmic curve and display transfer.

`src/rendering/` contains standalone ES modules for the frame graph, target pool,
quality budgets/controller, optional GPU timer, and cinematic pass orchestration.
The graph rejects cycles, duplicate resource writers and missing dependencies;
logical versions explicitly allow the particle pass to retain the scene color.

## Visual direction and controls

Credits exposes Clean, Cinematic (default), and Odyssey treatments plus adaptive
performance and an optional render-statistics overlay. Clean removes shafts,
streaks, ghosting, shockwaves, holographic rings, plasma arcs and dust, while
retaining glass, base lighting, original orbital particles and restrained bloom.

Cinematic/Odyssey add actual three-dimensional drifting dust, brighter plasma arc
currents in the glass, occluded rotating holographic calibration rings, image-driven
anamorphic streaks and optical ghosts, depth-bounded volumetric shafts, and
short time-addressable shockwave distortions at directed musical moments. Film
grading separates cool shadows from warmer highlights. Effects remain subordinate
to the product; the renderer never covers the text with a full-screen neon overlay.

Volumetric integration uses 8/12/16/20 steps at half internal resolution. The scene
stores distance along the camera ray in HDR alpha, avoiding another geometry pass
or render target. Four depth-weighted fog samples protect the product silhouette.
Sampling is deterministic and spatially jittered: this is NOT temporal accumulation,
and no motion vectors, temporal denoiser, depth-of-field or SSR are claimed.

## Performance contract

Normal playback submits without awaiting GPU completion. Asynchronous queue fences
limit outstanding work to two frames; capture and explicit deterministic frame
requests still await completion/readback. No per-frame texture, shader, pipeline,
uniform-buffer or bind-group creation occurs in steady state (the presentation view
and command/pass encoders are necessarily acquired each frame).

Descriptor-keyed HDR texture leases cache views. A 48 MiB LRU idle budget bounds
retained targets across extent/look changes; active memory follows the chosen quality
budget and output dimensions. Disposing the renderer destroys live and idle targets,
query resources, buffers and device resources. Resource diagnostics expose actual
creation/reuse/destruction counters rather than estimating allocations.

Output size and scene size are independent. Preview/Balanced/Cinema/Ultra initially
render the expensive analytic scene at .78/.85/.92/1 of the output dimensions.
Adaptive quality uses smoothed timings, hysteresis, discrete scale changes and a
1.8-second cooldown. It reduces internal pixels, volume steps and particle count,
never HTML typography or the recording/output extent. This is a 60 Hz budget target,
not a universal FPS guarantee. Recording and deterministic frames lock adaptation.
`?fixed=1` disables adaptive playback; `?look=odyssey` selects the dramatic treatment.

An optional timestamp-query ring reads GPU timings asynchronously every eighth
frame. Devices without the feature report completion latency explicitly, not fake
GPU timestamps. The renderer also exposes CPU submission time, pending submissions,
internal/output dimensions, graph passes, particles and pooled target memory.

The analytic field replaces repeated atan2-based torus harmonics with equivalent
sine/cosine polynomial identities, uses a four-evaluation tetrahedral SDF normal
instead of six central differences, and reduces higher-frequency noise work at
low adaptive scales. Each effect is driven by absolute film time, not accumulated
random events, so seeking/recording keep the same choreography.

## Audio, recording, compatibility

The iPhone audio module and recording encoder are unchanged. WebGPU recording
still copies the final presentation texture into a mapped, 256-byte-row-aligned
staging buffer inside the same submission. It records the full optical composite
before adding motion typography. Preparing/recording disables look and adaptation
controls; stop/error releases the capture lock. WebGL2 remains explicitly labelled
and keeps its original lightweight optics; it shares the optimized analytic scene
math but does not pretend to support the advanced WebGPU stack.

Both the normal module build and single-file edition include the new modules and
WGSL. Pages staging recursively includes them and hashes every deployed asset.

## Validation and reproducible measurements

`npm test` includes frame-graph, pooling, extent, adaptive-controller and timer
fallback tests plus the existing audio/timeline/recorder tests.

`tests/cinema_browser.py` uses actual native WebGPU to render all eight shots,
read back and compare the three looks, assert constant steady-state target counts,
check adaptive extent/backlog limits, exercise portrait framing, and compile the
single-file edition. It saves actual screenshots and JSON metrics. It can compare
the previous commit with `--baseline PATH` on the same browser/runner. The A/B uses
equal 960x540 output and the respective Balanced presets, NOT equal internal
resolution/workload; report includes both sizes and budgets. Short serialized frame
samples are not a full-film FPS, thermal, or physical-device qualification.

The existing `tests/recording_browser.py` continues to validate actual video/audio,
repeat recording, pause/resume, persistent downloads, natural end and failure
recovery. Consult Actions artifacts for executed results; no unexecuted test is a
pass. Local container browser navigation policy prevents local GPU validation.

## Primary API references

- WebGPU, resource lifetime, passes, query sets: https://www.w3.org/TR/webgpu/
- WGSL: https://www.w3.org/TR/WGSL/
- Chrome timestamp queries: https://developer.chrome.com/blog/new-in-webgpu-121
- MediaStream Recording: https://www.w3.org/TR/mediastream-recording/
