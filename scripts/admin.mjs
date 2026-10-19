// 光影档案 — 本地内容后台（零依赖）
// 用法: npm run admin  → http://127.0.0.1:4174
// 仅监听回环地址，不提供登录，请勿将端口暴露到公网。
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData } from '../src/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(root, 'data');
const DB = path.join(DATA_DIR, 'movies.json');
const CFG = path.join(DATA_DIR, 'site.config.json');
const BACKUP_DIR = path.join(DATA_DIR, '.backups');
const ADMIN_DIR = path.join(root, 'admin');
const HOST = '127.0.0.1';
const PORT = Number(process.env.ADMIN_PORT || process.argv[2] || 4174);
const PREVIEW_URL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const MAX_BODY = 4 * 1024 * 1024;
const BUILD_TIMEOUT = 60_000;
const TMDB_LISTS = {
  movie: new Set(['popular', 'top_rated', 'now_playing', 'upcoming']),
  tv: new Set(['popular', 'top_rated', 'airing_today', 'on_the_air']),
};

const ADMIN_MIME = {
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
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': [
    "default-src 'self'",
    "img-src 'self' data: https: http:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    const fail = (error) => {
      if (done) return;
      done = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', fail);
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new HttpError(500, `读取 ${path.relative(root, file)} 失败：${error.message}`);
  }
}

async function atomicWrite(file, content) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, 'utf8');
  try {
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

async function backupFile(file, prefix) {
  await mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await copyFile(file, path.join(BACKUP_DIR, `${prefix}-${stamp}.json`));
  const files = (await readdir(BACKUP_DIR))
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.json'))
    .sort();
  for (const name of files.slice(0, Math.max(0, files.length - 20))) {
    await unlink(path.join(BACKUP_DIR, name)).catch(() => {});
  }
}

async function backupCurrent() {
  await backupFile(DB, 'movies');
}

function runBuild() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/build.mjs'], {
      cwd: root,
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      stderr += `\n构建超时（${BUILD_TIMEOUT / 1000} 秒）`;
      child.kill();
      finish({ ok: false, code: null, timedOut: true, stdout, stderr });
    }, BUILD_TIMEOUT);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish({ ok: false, code: null, stdout, stderr });
    });
    child.on('close', (code) => {
      finish({ ok: code === 0, code, stdout, stderr });
    });
  });
}

let writeChain = Promise.resolve();
function withWriteLock(task) {
  const next = writeChain.then(task, task);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

function assertMutation(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, '请使用 application/json 提交');
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) throw new HttpError(403, '跨站请求被拒绝');
}

function assertHost(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) throw new HttpError(403, 'Host 不被允许');
}

const TMDB_TIMEOUT = 15_000;
const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

function normalizeProxy(value) {
  let raw = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (!raw || /^(none|off|direct|false|0)$/i.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
  return {
    protocol: parsed.protocol.slice(0, -1),
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port,
    auth: parsed.username ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}` : '',
    label: `${parsed.hostname}:${port}`,
  };
}

function readWindowsProxy() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  const query = (name) => new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', name], { windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : String(stdout));
    });
  });
  return (async () => {
    const enabled = await query('ProxyEnable');
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabled)) return null;
    const server = await query('ProxyServer');
    const match = server.match(/ProxyServer\s+REG_\w+\s+(.+)/);
    if (!match) return null;
    const raw = match[1].trim();
    const entries = new Map();
    for (const part of raw.split(';')) {
      const index = part.indexOf('=');
      if (index > 0) entries.set(part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim());
    }
    const chosen = entries.get('https') || entries.get('http') || (entries.size ? '' : raw);
    return normalizeProxy(chosen);
  })();
}

let tmdbProxyPromise = null;
function detectTmdbProxy() {
  if (!tmdbProxyPromise) {
    tmdbProxyPromise = (async () => {
      const explicit = String(process.env.TMDB_PROXY || '').trim();
      if (explicit) {
        const proxy = normalizeProxy(explicit);
        if (!proxy && !/^(none|off|direct|false|0)$/i.test(explicit)) {
          console.warn('[tmdb] TMDB_PROXY 格式无效，将尝试其他方式');
        }
        return proxy;
      }
      for (const name of PROXY_ENV_KEYS) {
        const value = String(process.env[name] || '').trim();
        if (!value) continue;
        if (/^(none|off|direct|false|0)$/i.test(value)) return null;
        const proxy = normalizeProxy(value);
        if (proxy) {
          console.log(`[tmdb] 使用环境变量 ${name} 的代理 ${proxy.label}`);
          return proxy;
        }
      }
      const systemProxy = await readWindowsProxy();
      if (systemProxy) console.log(`[tmdb] 使用系统代理 ${systemProxy.label}`);
      return systemProxy;
    })();
  }
  return tmdbProxyPromise;
}

function openProxyTunnel(proxy, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = proxy.protocol === 'https'
      ? tlsConnect({ host: proxy.host, port: proxy.port, servername: proxy.host })
      : netConnect({ host: proxy.host, port: proxy.port });
    let settled = false;
    let buffer = '';
    const timer = setTimeout(() => fail(new Error('proxy timeout')), timeoutMs);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    }

    function succeed() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', fail);
      socket.setTimeout(0);
      resolve(socket);
    }

    function onData(chunk) {
      buffer += chunk.toString('latin1');
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) {
        if (buffer.length > 16_384) fail(new Error('proxy response too large'));
        return;
      }
      const status = Number(buffer.slice(0, buffer.indexOf('\r\n')).split(' ')[1]);
      if (status !== 200) {
        fail(new Error(`proxy CONNECT failed (${status || 'unknown'})`));
        return;
      }
      succeed();
    }

    socket.once('error', fail);
    socket.once(proxy.protocol === 'https' ? 'secureConnect' : 'connect', () => {
      if (settled) return;
      socket.on('data', onData);
      const lines = [
        `CONNECT ${host}:${port} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Proxy-Connection: keep-alive',
      ];
      if (proxy.auth) lines.push(`Proxy-Authorization: Basic ${Buffer.from(proxy.auth).toString('base64')}`);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
    });
  });
}

function secureTargetSocket(socket, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tlsConnect({ socket, servername: host });
    let settled = false;
    const timer = setTimeout(() => fail(new Error('tls timeout')), timeoutMs);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tlsSocket.destroy();
      reject(error);
    }

    tlsSocket.once('secureConnect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(tlsSocket);
    });
    tlsSocket.once('error', fail);
  });
}

async function requestViaProxy(proxy, url, headers, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const host = url.hostname;
  const port = Number(url.port) || 443;
  const tunnel = await openProxyTunnel(proxy, host, port, remaining());
  let tlsSocket;
  try {
    tlsSocket = await secureTargetSocket(tunnel, host, remaining());
  } catch (error) {
    tunnel.destroy();
    throw error;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => req.destroy(new Error('request timeout')), remaining());
    const req = httpsRequest({
      host,
      port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
      createConnection: () => tlsSocket,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', fail);
    });

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tlsSocket.destroy();
      reject(error);
    }

    req.on('error', fail);
    req.end();
  });
}

async function requestTmdb(url, headers) {
  const proxy = await detectTmdbProxy();
  if (proxy) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        return await requestViaProxy(proxy, url, headers, TMDB_TIMEOUT);
      } catch (error) {
        lastError = error;
      }
    }
    console.warn(`[tmdb] 代理请求失败（${proxy.label}）：${lastError && lastError.message ? lastError.message : '未知错误'}`);
    throw new HttpError(502, `无法通过代理连接 TMDB（${proxy.label}），请确认代理已开启后重试`);
  }
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TMDB_TIMEOUT) });
  } catch {
    throw new HttpError(502, '无法连接 TMDB，请检查网络后重试');
  }
  let text;
  try {
    text = await res.text();
  } catch {
    throw new HttpError(502, '读取 TMDB 响应失败，请重试');
  }
  return { status: res.status, text };
}

async function tmdbRequest(apiKey, endpoint, params = {}) {
  const key = String(apiKey || '').trim();
  if (key.length < 10 || key.length > 500) throw new HttpError(400, 'TMDB Key 长度不正确');
  const url = new URL('https://api.themoviedb.org/3' + endpoint);
  Object.entries(params).forEach(([name, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
  });
  url.searchParams.set('language', process.env.TMDB_LANG || 'zh-CN');
  const headers = { accept: 'application/json', 'user-agent': 'CinemathequeAdmin/1.0' };
  if (key.length > 60) headers.authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);

  const response = await requestTmdb(url, headers);
  let body = null;
  try {
    body = JSON.parse(response.text);
  } catch { /* ignore */ }
  if (response.status < 200 || response.status >= 300) {
    const detail = body && body.status_message ? body.status_message : '';
    if (response.status === 401) throw new HttpError(401, 'TMDB API Key 无效或未授权');
    if (response.status === 404) throw new HttpError(404, 'TMDB 中没有找到该条目');
    if (response.status === 429) throw new HttpError(429, 'TMDB 请求过于频繁，请稍后再试');
    throw new HttpError(502, `TMDB 请求失败（${response.status}${detail ? `：${detail}` : ''}）`);
  }
  if (body === null) throw new HttpError(502, 'TMDB 返回了无法解析的数据');
  return body;
}

async function tmdbSearch(body) {
  const apiKey = String(body.apiKey || '').trim();
  const query = String(body.query || '').trim();
  const type = body.type === 'tv' ? 'tv' : body.type === 'movie' ? 'movie' : '';
  if (!query) throw new HttpError(400, '搜索词不能为空');
  if (query.length > 200) throw new HttpError(400, '搜索词过长');
  if (!type) throw new HttpError(400, 'type 必须是 movie 或 tv');
  let year = null;
  if (body.year !== undefined && body.year !== null && body.year !== '') {
    year = Number(body.year);
    if (!Number.isInteger(year) || year < 1888 || year > new Date().getFullYear() + 5) {
      throw new HttpError(400, '年份无效');
    }
  }
  const params = { query, include_adult: 'false', page: 1 };
  if (year) params[type === 'tv' ? 'first_air_date_year' : 'year'] = year;
  const data = await tmdbRequest(apiKey, type === 'tv' ? '/search/tv' : '/search/movie', params);
  const results = (Array.isArray(data.results) ? data.results : []).slice(0, 12).map((item) => ({
    id: item.id,
    title: item.title || item.name || '',
    originalTitle: item.original_title || item.original_name || '',
    year: Number(String(item.release_date || item.first_air_date || '').slice(0, 4)) || null,
    overview: item.overview || '',
    rating: typeof item.vote_average === 'number' ? Math.round(item.vote_average * 10) / 10 : null,
    votes: item.vote_count || 0,
    poster: item.poster_path ? `${TMDB_IMG}/w200${item.poster_path}` : '',
  }));
  return { results };
}

async function tmdbList(body) {
  const apiKey = String(body.apiKey || '').trim();
  const type = body.type === 'tv' ? 'tv' : body.type === 'movie' ? 'movie' : '';
  if (!type) throw new HttpError(400, 'type 必须是 movie 或 tv');
  const list = String(body.list || 'popular');
  if (!TMDB_LISTS[type].has(list)) throw new HttpError(400, '榜单类型无效');
  const page = Number(body.page === undefined ? 1 : body.page);
  if (!Number.isInteger(page) || page < 1 || page > 500) {
    throw new HttpError(400, 'page 应为 1–500 的整数');
  }
  const data = await tmdbRequest(apiKey, `/${type}/${list}`, { page });
  const results = (Array.isArray(data.results) ? data.results : [])
    .filter((item) => item && !item.adult && Number.isInteger(Number(item.id)) && Number(item.id) > 0)
    .map((item) => ({
      id: Number(item.id),
      title: item.title || item.name || '',
      originalTitle: item.original_title || item.original_name || '',
      year: Number(String(item.release_date || item.first_air_date || '').slice(0, 4)) || null,
      overview: item.overview || '',
      rating: typeof item.vote_average === 'number' ? Math.round(item.vote_average * 10) / 10 : null,
      votes: item.vote_count || 0,
      poster: item.poster_path ? `${TMDB_IMG}/w200${item.poster_path}` : '',
    }));
  return {
    results,
    page: Number(data.page) || page,
    totalPages: Math.min(Number(data.total_pages) || 0, 500),
    totalResults: Number(data.total_results) || 0,
  };
}

async function tmdbDetails(body) {
  const apiKey = String(body.apiKey || '').trim();
  const type = body.type === 'tv' ? 'tv' : body.type === 'movie' ? 'movie' : '';
  const id = Number(body.id);
  if (!type) throw new HttpError(400, 'type 必须是 movie 或 tv');
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id 无效');
  const data = await tmdbRequest(apiKey, `/${type}/${id}`, { append_to_response: 'credits' });
  const crew = (data.credits && data.credits.crew) || [];
  const cast = (data.credits && data.credits.cast) || [];
  const directors = [...new Set(crew.filter((person) => person.job === 'Director' && person.name).map((person) => person.name))];
  if (!directors.length && Array.isArray(data.created_by)) {
    data.created_by.forEach((person) => {
      if (person.name && !directors.includes(person.name)) directors.push(person.name);
    });
  }
  const fields = {
    title: data.title || data.name || '',
    originalTitle: data.original_title || data.original_name || '',
    year: Number(String(data.release_date || data.first_air_date || '').slice(0, 4)) || '',
    rating: typeof data.vote_average === 'number' ? Math.round(data.vote_average * 10) / 10 : null,
    votes: data.vote_count || 0,
    runtime: data.runtime || (Array.isArray(data.episode_run_time) ? data.episode_run_time[0] : 0) || '',
    genres: (data.genres || []).map((genre) => genre.name).filter(Boolean),
    country: (data.production_countries || []).map((country) => country.name).filter(Boolean).join(' / '),
    language: (data.spoken_languages || []).map((language) => language.name).filter(Boolean).join(' / '),
    directors,
    cast: cast.slice(0, 6).map((person) => person.name).filter(Boolean),
    tagline: data.tagline || '',
    overview: data.overview || '',
    poster: data.poster_path ? `${TMDB_IMG}/w500${data.poster_path}` : '',
    backdrop: data.backdrop_path ? `${TMDB_IMG}/w1280${data.backdrop_path}` : '',
    tmdbId: data.id,
  };
  return { fields };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/data') {
    const [db, cfg] = await Promise.all([readJson(DB), readJson(CFG)]);
    const movies = Array.isArray(db.movies) ? db.movies : [];
    sendJson(res, 200, {
      movies,
      meta: { updated: db.updated || '', note: db.note || '', count: movies.length },
      collections: (Array.isArray(cfg.collections) ? cfg.collections : [])
        .filter((collection) => collection && collection.id && collection.name)
        .map((collection) => ({ id: collection.id, name: collection.name })),
      qualityTiers: cfg.qualityOrder || ['4K', '1080P', '720P'],
      site: { title: cfg.title || '光影档案', url: cfg.url || '', base: cfg.base || '' },
      previewUrl: PREVIEW_URL,
    });
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/movies') {
    assertMutation(req);
    const body = await readBody(req);
    if (!body || !Array.isArray(body.movies)) throw new HttpError(400, 'movies 必须是数组');
    const cfg = await readJson(CFG);
    const result = await withWriteLock(async () => {
      const current = await readJson(DB);
      const next = { ...current, movies: body.movies, updated: today() };
      const validation = validateData(next, cfg);
      if (validation.errors.length) {
        throw new HttpError(422, '数据校验未通过', {
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }
      await backupCurrent();
      await atomicWrite(DB, JSON.stringify(next, null, 2) + '\n');
      const build = await runBuild();
      return {
        ok: true,
        warnings: validation.warnings,
        build,
        meta: { updated: next.updated, count: next.movies.length },
      };
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/site') {
    sendJson(res, 200, { config: await readJson(CFG) });
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/site') {
    assertMutation(req);
    const body = await readBody(req);
    const config = body && body.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new HttpError(400, 'config 必须是对象');
    const db = await readJson(DB);
    const result = await withWriteLock(async () => {
      const validation = validateData(db, config);
      if (validation.errors.length) {
        throw new HttpError(422, '站点设置校验未通过', {
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }
      await backupFile(CFG, 'site');
      await atomicWrite(CFG, JSON.stringify(config, null, 2) + '\n');
      const build = await runBuild();
      return { ok: true, warnings: validation.warnings, build };
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/build') {
    assertMutation(req);
    await readBody(req);
    const result = await withWriteLock(runBuild);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tmdb/search') {
    assertMutation(req);
    const body = await readBody(req);
    sendJson(res, 200, await tmdbSearch(body));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tmdb/list') {
    assertMutation(req);
    const body = await readBody(req);
    sendJson(res, 200, await tmdbList(body));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tmdb/details') {
    assertMutation(req);
    const body = await readBody(req);
    sendJson(res, 200, await tmdbDetails(body));
    return;
  }

  throw new HttpError(404, '接口不存在');
}

async function serveAdmin(res, pathname) {
  if (pathname === '/favicon.ico') {
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
    return;
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(ADMIN_DIR, relative);
  if (!file.startsWith(ADMIN_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) throw new HttpError(404, '页面不存在');
  const body = await readFile(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': ADMIN_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
    'content-length': body.length,
  });
  res.end(body);
}

async function handleRequest(req, res) {
  assertHost(req);
  const url = new URL(req.url || '/', `http://${req.headers.host || HOST}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, '路径无效');
  }
  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname);
    return;
  }
  if (req.method !== 'GET') throw new HttpError(405, '只支持 GET');
  await serveAdmin(res, pathname);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const known = error instanceof HttpError;
    if (!known) console.error('[admin]', error);
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, known ? error.status : 500, {
      error: known ? error.message : '服务器内部错误',
      ...(known ? error.extra : {}),
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('光影档案 · 本地内容后台');
  console.log(`▸ 后台地址: http://${HOST}:${PORT}`);
  console.log(`  数据文件: data/movies.json`);
  console.log(`  自动备份: ${path.relative(root, BACKUP_DIR)}/`);
  console.log(`  站点预览: ${PREVIEW_URL}（需另开 npm run preview）`);
  console.log('  仅限本机使用，请勿将端口暴露到公网。');
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
