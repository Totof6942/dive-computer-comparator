"""Local dev server that disables browser caching.

python3 -m http.server sends no Cache-Control header, so browsers may reuse a
stale JS module next to a fresh one and the app fails to load after an update.
"""
import functools
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "."


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"Palier: http://localhost:{PORT} ({DIRECTORY})")
    handler = functools.partial(NoCacheHandler, directory=DIRECTORY)
    http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
