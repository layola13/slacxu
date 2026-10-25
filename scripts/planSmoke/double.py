#!/usr/bin/env python3
# planSmoke double: scripted Responses SSE upstream.
# req1 update_plan (unfinished), req2 text (premature stop),
# req3 update_plan (all completed), req4 text "all done".
# A correct bridge makes FOUR requests: the text round cannot
# complete while the plan has unfinished steps (CXU 0.1.10).
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

COUNT_FILE = "plan_requests.count"

PLAN_OPEN = json.dumps({"plan": [{"step": "first", "status": "in_progress"}, {"step": "second", "status": "pending"}]})
PLAN_DONE = json.dumps({"plan": [{"step": "first", "status": "completed"}, {"step": "second", "status": "completed"}]})


def call_events(call_id, args):
    item = {"type": "function_call", "id": "fc_" + call_id, "call_id": call_id,
            "name": "update_plan", "arguments": "", "status": "in_progress"}
    done_item = dict(item)
    done_item["arguments"] = args
    done_item["status"] = "completed"
    ev = [
        ("response.output_item.added", {"type": "response.output_item.added", "output_index": 0, "item": item}),
        ("response.function_call_arguments.delta", {"type": "response.function_call_arguments.delta", "item_id": item["id"], "output_index": 0, "delta": args}),
        ("response.function_call_arguments.done", {"type": "response.function_call_arguments.done", "item_id": item["id"], "output_index": 0, "arguments": args}),
        ("response.output_item.done", {"type": "response.output_item.done", "output_index": 0, "item": done_item}),
        ("response.completed", {"type": "response.completed", "response": {"id": "resp_p", "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}}}),
    ]
    return ev


def text_events(text):
    item = {"type": "message", "id": "msg_t", "role": "assistant", "status": "in_progress", "content": []}
    done_item = {"type": "message", "id": "msg_t", "role": "assistant", "status": "completed",
                 "content": [{"type": "output_text", "text": text, "annotations": []}]}
    return [
        ("response.output_item.added", {"type": "response.output_item.added", "output_index": 0, "item": item}),
        ("response.output_text.delta", {"type": "response.output_text.delta", "item_id": "msg_t", "output_index": 0, "content_index": 0, "delta": text}),
        ("response.output_item.done", {"type": "response.output_item.done", "output_index": 0, "item": done_item}),
        ("response.completed", {"type": "response.completed", "response": {"id": "resp_t", "usage": {"input_tokens": 8, "output_tokens": 4, "total_tokens": 12}}}),
    ]


SCRIPT = [call_events("call_p1", PLAN_OPEN), text_events("stopping here"),
          call_events("call_p2", PLAN_DONE), text_events("all done")]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(n)
        try:
            count = int(open(COUNT_FILE).read().strip())
        except Exception:
            count = 0
        count += 1
        open(COUNT_FILE, "w").write(str(count))
        ev = SCRIPT[min(count, len(SCRIPT)) - 1]
        body = "".join("event: %s\ndata: %s\n\n" % (t, json.dumps(d)) for t, d in ev)
        data = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


HTTPServer(("127.0.0.1", 19093), H).serve_forever()
