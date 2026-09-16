# GitHub publication handoff

Target repository: https://github.com/wieslawsoltes/AetherOrbOdyssey

Default Pages URL **after a successful deployment**: https://wieslawsoltes.github.io/AetherOrbOdyssey/

## One-command publication

Use Git, Python 3.10+, Node.js 20+ and an authenticated GitHub CLI on your machine.
Authenticate locally with `gh auth login --hostname github.com --git-protocol https --scopes repo,workflow --web`.
The account must be allowed to push workflow files and manage this repository's Pages settings.
Do not put access tokens in the project or paste them into chat.

From the extracted `AetherOrbOdyssey` directory:

```sh
bash tools/publish-github.sh
```

The helper validates the complete source snapshot, restores the prepared local commits from
`AetherOrbOdyssey-history.bundle` when the distribution includes it, and pushes `main`.
It then enables workflow-based Pages, dispatches the workflow, watches the matching commit's
run to completion, and verifies every published asset against the deployment manifest.
It prints a live URL only after these steps succeed. Running it again is supported.

It never force-pushes, deletes remote branches, overwrites unrelated remote history, changes
an existing origin to another repository, commits unreviewed local changes to an existing
repository, or changes global Git credentials. Concurrent remote updates are rejected by
normal fast-forward push semantics. An unrelated/newer remote `main` stops publication.

The history bundle is a transport artifact, not a runtime dependency; it is gitignored and
is not itself committed or published on Pages. Without a bundle the helper creates a snapshot
commit using the locally authenticated account's name and GitHub noreply address.

Local-only validation, without authentication or writes:

```sh
bash tools/publish-github.sh --check-only
```

## What the Pages workflow does

1. Verifies the source SHA-256 inventory; runs Node tests, Python deployment tests and syntax checks.
2. Rebuilds the compatibility shader and single-file edition, rejecting generated-file drift.
3. Downloads the already credited recording and checks its documented 4,307,636-byte size and SHA-1.
4. Stages only the runtime, shader files, music and attribution into `_site/`.
5. Deploys using GitHub's official Pages artifact and deployment actions.
6. Checks the public commit marker and SHA-256 of every runtime file, including music.

The recording is therefore served from the same Pages origin instead of depending on a
visitor's cross-origin download. The repository/source archive still does not contain those
recording bytes. If the download or checksum fails, production publication fails rather than
silently shipping an incomplete audio experience. The app retains its existing explicit
local-audio and silent-preview controls.

The SHA-1 is an integrity comparison with the documented Commons object, not a digital
signature or a general security guarantee. The staged publication manifest also uses SHA-256.
Keep the music attribution in `NOTICE.md` and the in-app Credits panel intact.

## Workflows and permissions

`.github/workflows/pages.yml` runs on pushes to `main`, pull requests targeting `main`, and
manual dispatch. Pull requests validate and build but do not publish. Deployment is a separate
job with `pages: write` and `id-token: write`. No PAT or custom deployment secret is required
inside the workflow. Actions are pinned to full commit SHAs; Dependabot is configured to
propose action updates.

The helper uses the owner's local authenticated `gh` session only for initial repository
pushes, Pages configuration and workflow dispatch. The CI deployment uses `GITHUB_TOKEN`.
GitHub's built-in workflow token is not used to grant itself repository administration rights.
Protected environments/branches and organization policies remain enforced; the helper does
not remove protection or auto-approve a protected environment.

## Source editing

After intentional edits:

```sh
python3 tools/build_compat.py
python3 tools/build_single.py
python3 tools/manifest.py write
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
git add -A
git commit -m "Describe the change"
git push origin main
```

A full production local staging build requires:

```sh
python3 tools/fetch_music.py
python3 tools/build_pages.py
```

`python3 tools/build_pages.py --allow-missing-music` is reserved for visual-only local
validation. Production CI never uses it. The staged runtime intentionally has no dotfiles, which the Pages uploader excludes. No rewrite rules or server-side backend are needed;
all runtime and shader URLs remain relative, including at the `/AetherOrbOdyssey/` subpath.

## Validation boundary of this handoff

The repository was readable through the connected GitHub account, but that connection exposed
no write action in this session. The local Git transport failed DNS resolution for GitHub.
Consequently the prepared commits are **local only** and this handoff does **not** claim a
remote push, executed GitHub Actions run, fetched production music, or live Pages publication.
The local staging/HTTP tests are not native WebGPU or hardware-performance validation.
See `docs/PUBLICATION-QA.md` for the executed checks and `QA.md` for the original film tests.

## Reference documentation

- Pages workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- Pages API and permissions: https://docs.github.com/en/rest/pages/pages
- CLI authenticated API: https://cli.github.com/manual/gh_api
- CLI workflow monitoring: https://cli.github.com/manual/gh_run_watch
- Recording source and documented checksum: https://commons.wikimedia.org/wiki/File:Also_Sprach_Zarathustra_-_Einleitung.ogg
