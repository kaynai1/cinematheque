// 零依赖静态预览服务器
// 用法: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const port = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
    const s = await stat(file).catch(() => null);
    const target = s && s.isDirectory() ? path.join(file, 'index.html') : file;
    const body = await readFile(target).catch(() => null);
    if (!body) {
      const nf = await readFile(path.join(root, '404.html')).catch(() => null);
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(nf || '404');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end('Internal error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`▸ 预览地址: http://127.0.0.1:${port}`);
  console.log(`  目录: ${root}`);
  console.log('  Ctrl+C 停止');
});
