// Tiny static file server used by Playwright until the real Vite dev
// server lands. Serves a directory tree on the given port. Replace
// usage with `vite` once packages/web has its dev server.
//
// Usage: node tools/static-server.mjs <root-dir> <port>

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname, normalize } from "node:path";

const [, , rootArg, portArg] = process.argv;
if (!rootArg || !portArg) {
  console.error("Usage: node tools/static-server.mjs <root-dir> <port>");
  process.exit(2);
}

const root = resolve(rootArg);
const port = Number(portArg);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": types[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, () => {
  console.log(`static-server: serving ${root} on http://localhost:${port}`);
});
