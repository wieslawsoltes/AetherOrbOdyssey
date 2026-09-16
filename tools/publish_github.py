#!/usr/bin/env python3
"""Publish this complete snapshot to the requested GitHub repository and Pages.

Uses the owner's local gh credentials, performs fast-forward-only Git writes,
and verifies the exact public revision. No credentials are stored in this tree.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
REPO = 'wieslawsoltes/AetherOrbOdyssey'
REMOTE = f'https://github.com/{REPO}.git'
BUNDLE = ROOT / 'AetherOrbOdyssey-history.bundle'

class PublicationError(RuntimeError):
    pass

def run(args: list[str], *, capture: bool = False, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=capture, check=False,
                            env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GH_PROMPT_DISABLED': '1'})
    if check and result.returncode:
        detail = (result.stderr or result.stdout or '').strip() if capture else ''
        raise PublicationError(f"Command failed ({result.returncode}): {' '.join(args)}\n{detail}")
    return result

def git(*args: str, capture: bool = False, check: bool = True) -> subprocess.CompletedProcess:
    # Credentials are supplied only for this process; no global configuration changes.
    return run(['git', '-c', 'credential.helper=', '-c',
                'credential.helper=!gh auth git-credential', *args], capture=capture, check=check)

def api(endpoint: str, *args: str) -> dict:
    result = run(['gh', 'api', '--hostname', 'github.com', endpoint, *args], capture=True)
    return json.loads(result.stdout) if result.stdout.strip() else {}

def normalized_remote(value: str) -> str:
    value = value.strip().rstrip('/')
    if value.startswith('git@github.com:'):
        value = 'https://github.com/' + value[len('git@github.com:'):]
    if value.endswith('.git'):
        value = value[:-4]
    return value.lower()

def prepare_git() -> None:
    if not (ROOT / '.git').exists():
        parent_repo = git('rev-parse', '--show-toplevel', capture=True, check=False)
        if parent_repo.returncode == 0:
            raise PublicationError('This folder is nested inside another Git repository. Extract it outside that repository first.')
        git('init', '--initial-branch=main')
        if BUNDLE.is_file():
            # Restore prepared commit history without resetting/deleting working files.
            git('bundle', 'verify', str(BUNDLE))
            git('fetch', str(BUNDLE), 'refs/heads/main')
            git('update-ref', 'refs/heads/main', 'FETCH_HEAD')
            git('reset', '--mixed', 'HEAD')
        else:
            profile = api('user')
            name = profile.get('name') or profile['login']
            email = f"{profile['id']}+{profile['login']}@users.noreply.github.com"
            git('add', '--all')
            git('-c', f'user.name={name}', '-c', f'user.email={email}',
                '-c', 'commit.gpgsign=false', 'commit',
                '-m', 'Import complete Aether Orb Odyssey and GitHub Pages publication workflow')
    top = Path(git('rev-parse', '--show-toplevel', capture=True).stdout.strip()).resolve()
    if top != ROOT.resolve():
        raise PublicationError('Refusing to publish a different repository root.')
    if git('branch', '--show-current', capture=True).stdout.strip() != 'main':
        raise PublicationError('The prepared source must be on main; no branch is switched automatically.')
    status = git('status', '--porcelain', capture=True).stdout.strip()
    if status:
        raise PublicationError('Uncommitted changes exist. Review and commit them before publication:\n' + status)
    existing = git('remote', 'get-url', 'origin', capture=True, check=False)
    if existing.returncode == 0:
        if normalized_remote(existing.stdout) != normalized_remote(REMOTE):
            raise PublicationError('origin points to another repository; refusing to change it.')
    else:
        git('remote', 'add', 'origin', REMOTE)

def verify_remote_history() -> None:
    refs = git('ls-remote', '--heads', REMOTE, capture=True).stdout.strip().splitlines()
    if not refs:
        return
    main = [line.split()[0] for line in refs if line.endswith('\trefs/heads/main')]
    if not main:
        raise PublicationError('The remote has other branches but no main. No existing history will be replaced.')
    git('fetch', REMOTE, 'refs/heads/main:refs/remotes/origin/main')
    compatible = git('merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD', check=False)
    if compatible.returncode:
        raise PublicationError('Remote main contains unrelated/newer work. Refusing a force push; merge it explicitly first.')

def enable_pages() -> None:
    endpoint = f'repos/{REPO}/pages'
    probe = run(['gh', 'api', '--hostname', 'github.com', endpoint], capture=True, check=False)
    if probe.returncode == 0:
        if json.loads(probe.stdout).get('build_type') != 'workflow':
            api(endpoint, '--method', 'PUT', '-f', 'build_type=workflow')
    elif 'HTTP 404' in (probe.stderr or ''):
        # Called AFTER main is created, so GitHub has a valid source branch.
        api(endpoint, '--method', 'POST', '-f', 'build_type=workflow')
    else:
        raise PublicationError('Cannot inspect Pages settings:\n' + (probe.stderr or probe.stdout))

def dispatch_and_watch(commit: str) -> str:
    endpoint = f'repos/{REPO}/actions/workflows/pages.yml'
    available = False
    for _ in range(30):
        response = run(['gh', 'api', '--hostname', 'github.com', endpoint], capture=True, check=False)
        if response.returncode == 0:
            available = True
            break
        if 'HTTP 404' not in (response.stderr or ''):
            raise PublicationError(response.stderr or 'Cannot inspect the Pages workflow.')
        time.sleep(2)
    if not available:
        raise PublicationError('Workflow registration was not visible. Re-run this helper; it will not force-push.')
    dispatched_at = datetime.now(timezone.utc).replace(microsecond=0)
    api(endpoint + '/dispatches', '--method', 'POST', '-f', 'ref=main')
    workflow_run = None
    query = endpoint + '/runs?event=workflow_dispatch&branch=main&per_page=50'
    for _ in range(40):
        candidates = api(query).get('workflow_runs', [])
        for candidate in candidates:
            created_at = datetime.fromisoformat(candidate['created_at'].replace('Z', '+00:00'))
            if candidate.get('head_sha') == commit and created_at >= dispatched_at:
                workflow_run = candidate
                break
        if workflow_run:
            break
        time.sleep(3)
    if not workflow_run:
        raise PublicationError('No matching dispatched run became visible. Inspect Actions; no deployment success is claimed.')
    print(f"Deployment run: {workflow_run['html_url']}", flush=True)
    watched = run(['gh', 'run', 'watch', str(workflow_run['id']), '--repo', REPO,
                   '--interval', '5', '--exit-status'], check=False)
    if watched.returncode:
        run(['gh', 'run', 'view', str(workflow_run['id']), '--repo', REPO, '--log-failed'], check=False)
        raise PublicationError('The deployment workflow did not succeed. See the reported logs.')
    return api(f'repos/{REPO}/pages')['html_url']

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true',
                        help='Validate the local source without authentication, commits, pushes, or API writes.')
    args = parser.parse_args()
    for executable in ('git', 'node', 'npm'):
        if shutil.which(executable) is None:
            raise PublicationError(f'Missing {executable}. Install Git and Node.js 20+ first.')
    run([sys.executable, 'tools/manifest.py', 'check'])
    run(['npm', 'test'])
    run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'])
    if args.check_only:
        print('Local checks passed. No GitHub writes, Pages changes, or publication were attempted.')
        return 0
    if shutil.which('gh') is None:
        raise PublicationError('GitHub CLI is missing. Install gh, run gh auth login, then re-run this helper.')
    auth = run(['gh', 'auth', 'status', '--hostname', 'github.com'], capture=True, check=False)
    if auth.returncode:
        raise PublicationError('Run gh auth login --hostname github.com --git-protocol https --scopes repo,workflow --web, then re-run. Never paste credentials into chat.')
    repo = api(f'repos/{REPO}')
    if repo.get('archived'):
        raise PublicationError('The repository is archived.')
    if repo.get('private'):
        raise PublicationError('The target is now private; review intended Pages visibility before publication.')
    if not repo.get('permissions', {}).get('push'):
        raise PublicationError('The local GitHub account does not have repository push access.')
    prepare_git()
    verify_remote_history()
    commit = git('rev-parse', 'HEAD', capture=True).stdout.strip()
    # A normal push rejects concurrent remote updates. Never --force or --mirror.
    git('push', REMOTE, 'refs/heads/main:refs/heads/main')
    print(f'Pushed {commit} to {REPO}/main.', flush=True)
    enable_pages()
    url = dispatch_and_watch(commit)
    run([sys.executable, 'tools/verify_site.py', '--url', url,
         '--commit', commit, '--attempts', '12'])
    print(f'PUBLISHED AND VERIFIED: {url}\nRepository: https://github.com/{REPO}\nCommit: {commit}')
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (PublicationError, OSError, ValueError, KeyError) as exc:
        print(f'Publication stopped: {exc}', file=sys.stderr)
        raise SystemExit(1)
