// ops/tests/fixtures/fake-app.mjs — loopback stand-in for the real server.
//
// Serves the §24.3 health shape with behavior controlled by env vars or a
// BEHAVIOR_FILE of KEY=VALUE lines. The behavior file is re-read on every
// request, so tests can point it at $CURRENT_LINK/runtime-behavior.env and
// observe an atomic symlink switch change the served release instantly.
import http from "node:http";
import fs from "node:fs";

const port = Number(process.env.PORT);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port <= 0) {
  console.error("fake-app: PORT env var required");
  process.exit(2);
}

function behavior() {
  const b = {
    LIVE_OK: process.env.LIVE_OK ?? "1",
    READY_OK: process.env.READY_OK ?? "1",
    RELEASE_ID: process.env.RELEASE_ID ?? "unknown",
    READY_DETAIL: process.env.READY_DETAIL ?? "",
  };
  const f = process.env.BEHAVIOR_FILE;
  if (f) {
    try {
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) b[m[1]] = m[2];
      }
    } catch {
      // missing behavior file: keep defaults
    }
  }
  return b;
}

const srv = http.createServer((req, res) => {
  const b = behavior();
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.url === "/health/live") return send(b.LIVE_OK === "1" ? 200 : 503, { ok: b.LIVE_OK === "1" });
  if (req.url === "/health/ready") {
    return send(b.READY_OK === "1" ? 200 : 503, { ready: b.READY_OK === "1", detail: b.READY_DETAIL });
  }
  if (req.url === "/release") return send(200, { releaseId: b.RELEASE_ID });
  if (req.url === "/api/health") return send(200, { ok: true });
  return send(404, { error: "not found" });
});

srv.listen(port, host, () => console.log(`fake-app listening ${host}:${port}`));
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    srv.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 200).unref();
  });
}
