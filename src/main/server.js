// Local HTTP server for the interface. It is needed because a YouTube iframe loaded from file://
// fails with error 153 (no Referer/origin). From http://127.0.0.1 embedding works like on a normal site.
// The port is fixed so the origin (and with it localStorage with the settings) stays the same between runs.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(server.address().port);
    });
  });
}

// Local files: /local/file/<id> (with Range support, so seeking works) and /local/cover/<id>.
// `local` = { path(id) -> file or null, mime(file), cover(file) -> { data, type } | null }
async function serveLocal(local, urlPath, req, res) {
  const m = urlPath.match(/^\/local\/(file|cover)\/([0-9a-f]{8,40})$/);
  const file = m && local.path(m[2]);
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (m[1] === 'cover') {
    const cover = await local.cover(file);
    if (!cover) res.writeHead(404).end('No cover');
    else res.writeHead(200, { 'Content-Type': cover.type, 'Cache-Control': 'max-age=3600' }).end(cover.data);
    return;
  }
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    res.writeHead(404).end('File is gone');
    return;
  }
  const type = local.mime(file);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = stat.size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else {
      start = Math.max(0, stat.size - Number(range[2])); // "last N bytes"
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      return;
    }
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export async function startServer(rootDir, preferredPort = 47831, local = null) {
  const root = path.resolve(rootDir);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (local && urlPath.startsWith('/local/')) {
        await serveLocal(local, urlPath, req, res);
        return;
      }
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const file = path.resolve(root, rel);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });

  let port;
  try {
    port = await listen(server, preferredPort);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    port = await listen(server, 0); // preferred port is taken: use any free one
  }
  return { server, port };
}
