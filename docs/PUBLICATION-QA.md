# Publication preparation validation — 2026-09-16

## Source provenance

The complete `Aether_Orb_Odyssey_Rebuild.zip` was extracted and all **39** entries in its
original SHA-256 manifest passed before any changes. The original archive has 40 files
including the manifest itself. The first local Git commit preserves that source snapshot
unchanged. The original inventory is also copied to `docs/BASELINE-MANIFEST.json`.

A second local commit adds publication tooling, CI, documentation, Git attributes and updated
source inventory. The film's six source modules, five shader files, visual styling, HTML
player, standalone visual runtime and all preview images remain unchanged.

## Checks executed in this session

- Four existing Node timeline/camera tests: passed on Node 22.16.0.
- Ten new Python publication tests: passed on Python 3.13.5.
- Actual local HTTP checks of all 15 non-audio runtime files under `/AetherOrbOdyssey/`:
  passed; each file's byte count and SHA-256 were checked.
- Production staging rejects absent music; preview staging also rejects corrupted music.
- Verification rejects incorrect deployment revisions, tampered shader content,
  a traversal path in a deployment manifest and a production site without music.
- The staging builder rejects an arbitrary output directory and does not publish Git
  internals, build tools, tests or development documentation.
- Compatibility GLSL and the standalone HTML were regenerated and remained byte-identical.
- All six JavaScript modules passed `node --check`.
- Python tools/tests passed `compileall`; the publication wrapper passed `bash -n`.
- Full source inventory generated with SHA-256; `tools/manifest.py check` verifies the snapshot.

The Python HTTP test uses real loopback networking and the original application bytes.
No replacement music recording or synthetic audio fixture is added by these publication tests.

## Explicit boundaries

- No authenticated remote write could be made from this session. The GitHub connector
  exposes repository reads but no commit/push/Pages-setting actions, and local Git network
  operations cannot resolve GitHub. Local commit IDs are not GitHub commit confirmations.
- GitHub Actions has not run this workflow; successful local checks are not a remote CI result.
- Production music download and playback were not performed here. CI is configured to fetch
  and verify the previously credited recording before deployment, and to fail if unavailable.
- GitHub Pages publication and public HTTPS asset verification have not happened here.
- The publishing helper's authenticated API writes and remote workflow monitoring remain
  unexecuted. `--check-only` makes no such writes.
- Native WebGPU rendering and hardware performance were not revalidated during this
  publication task. The original rendering test boundaries remain in the root `QA.md`.

The local history bundle preserves the prepared commits. After publication, use the actual
Actions run and public `deployment.json` to establish the deployed revision.
