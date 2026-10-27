#!/usr/bin/env python3
"""Local HTTP stub for the freeModelAccess probe (AD3 rebuild).

Mimics the free-key service surface the TS client calls:
  POST /v1/access/status      -> {"data": <RemoteAccessStatus>}
  POST /v1/access/requirement -> {"data": {"requiredCode": "REQ-42", "expiresAt": 999}}
  POST /v1/access/prepare     -> {"data": <RemoteAccessStatus + allowed/auth fields>}
  POST /v1/access/complete    -> {"data": {}}
The "expired" key (cxu-BBB...) yields license.valid=false, reason="expired".
Every request's Authorization header is appended to /tmp/fma_stub_auth.txt.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

GOOD_KEY = "cxu-" + "A" * 48
EXPIRED_KEY = "cxu-" + "B" * 48


def status_data(key):
    if key == EXPIRED_KEY:
        lic = {"valid": False, "reason": "expired"}
    else:
        lic = {"valid": True, "reason": "active", "keyPreview": "cxu-...preview",
               "issuedAt": 111, "expiresAt": 222}
    return {
        "license": lic,
        "refreshIntervalHours": 5,
        "lastRefreshedAt": None,
        "nextRequiredRefreshAt": 123,
        "refreshRequired": False,
        "discordInviteUrl": "https://discord.gg/test",
        "campaign": None,
    }


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {}
        with open("/tmp/fma_stub_auth.txt", "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (self.path, self.headers.get("Authorization") or ""))
        if self.path == "/v1/access/status":
            data = status_data(body.get("key"))
        elif self.path == "/v1/access/requirement":
            data = {"requiredCode": "REQ-42", "expiresAt": 999}
        elif self.path == "/v1/access/prepare":
            data = status_data(body.get("key"))
            data.update({"allowed": True, "authorizationId": "auth-1",
                         "authorizationExpiresAt": 555})
        elif self.path == "/v1/access/complete":
            data = {}
        else:
            self.send_response(404)
            self.end_headers()
            return
        payload = json.dumps({"data": data}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 18741), Handler).serve_forever()
