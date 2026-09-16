# Cinematic renderer 3.0.0

See [the pipeline specification](CINEMATIC-RENDERER.md) for implemented effects,
quality budgets, module contracts, recording behavior and explicit limitations.

## Release hardening

Stable frames bypass extent-array and descriptor-key reconstruction. Quality,
look, adaptive scale and output extent changes invalidate the cached layout.
Failed setup does not poison that cache. Sustained completion times above 250 ms
are saturated, not discarded: heavily overloaded GPUs can still downscale. All
adaptive configuration values must be finite. Recording retains its fixed extent
and capture-quality lock.

The frame graph snapshots and freezes dependency lists so consumers cannot mutate
execution dependencies after compilation. GPU timestamp diagnostics remain null
until an actual timestamp sample exists. Unit tests cover the supported timer ring,
nonblocking sampling, exhausted slots, failed maps, wrapped/zero timestamps, and
disposal during an outstanding map, plus the unsupported-feature path.

## Release gates

The source suite contains 52 JavaScript tests and 13 Python tests. Native browser
validation renders all eight shots, compares all three looks, exercises every
quality preset, checks fixed capture extents, verifies resource reuse and releases
all pooled targets on disposal. The single-file edition must compile too.

Actual recordings are decoded to check video, audio, repeat capture, pause/resume,
manual download, natural end and failure recovery. GitHub Pages requires these
native macOS Chrome and Linux WebGL2 compatibility checks, as well as Chromium and
WebKit audio checks. A hosted runner is not the user's physical device. Passing
short captures is not a full-duration 1080p or mobile thermal-performance guarantee.

Screenshots, exact browser/OS details and benchmark data are preserved as Actions
artifacts. No native Linux WebGPU or physical iPhone rendering pass is claimed.
