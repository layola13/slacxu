import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sk-probe":
            self._send(401, {"error": "unauthorized"})
            return
        if self.path == "/v1/models":
            self._send(200, {"data": [{"id": "gpt-probe"}]})
            return
        self._send(404, {"error": "nf"})
    def do_POST(self):
        if self.headers.get("Authorization") != "Bearer sk-probe":
            self._send(401, {"error": "unauthorized"})
            return
        if self.path == "/v1/chat/completions":
            self._send(200, {"choices": [{"message": {"content": "hi"}}]})
            return
        self._send(404, {"error": "nf"})

HTTPServer(("127.0.0.1", 18778), H).serve_forever()
