#!/usr/bin/env python3
"""Local development server. Python standard library only; no package installation."""
import argparse
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js':'text/javascript', '.wgsl':'text/plain', '.mjs':'text/javascript', '.mp3':'audio/mpeg', '.ogg':'audio/ogg'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

def main():
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8080);p.add_argument('--host',default='127.0.0.1');p.add_argument('--fetch-music',action='store_true',help='Download and verify the credited recording before serving');a=p.parse_args()
    if a.fetch_music:
        from fetch_music import fetch_music
        try: fetch_music()
        except (OSError,ValueError) as exc: print(f'Music was not downloaded: {exc}. Browser loading remains available.',file=sys.stderr)
    try:
        server=http.server.ThreadingHTTPServer((a.host,a.port),functools.partial(Handler,directory=str(ROOT)))
    except OSError as e:
        print(f'Cannot bind {a.host}:{a.port}: {e}',file=sys.stderr);return 1
    print(f'Aether Orb Odyssey: http://{a.host}:{a.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
    return 0
if __name__=='__main__':sys.exit(main())
