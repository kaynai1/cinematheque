// TMDB 元数据补全脚本 —— 可选
// 用法:
//   set TMDB_API_KEY=你的key        (Windows PowerShell: $env:TMDB_API_KEY="...")
//   npm run fetch:tmdb
//
// 作用: 读取 data/movies.json，对每个条目按片名+年份查询 TMDB，
//       写入真实的评分、票数、简介、海报与背景图地址，然后覆盖回 data/movies.json。
// 说明: TMDB 官方 API 免费，个人站点用途无需付费；请遵守其使用条款并署名。
//       不配置 key 时站点使用内置的渐变海报占位，同样可以正常构建。

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'data/movies.json');
const KEY = process.env.TMDB_API_KEY || process.env.TMDB_TOKEN || '';
const LANG = process.env.TMDB_LANG || 'zh-CN';
const IMG = 'https://image.tmdb.org/t/p';

if (!KEY) {
  console.error('缺少 TMDB API 凭证。请设置环境变量 TMDB_API_KEY 后重试。');
  console.error('申请地址: https://www.themoviedb.org/settings/api');
  process.exit(1);
}

const db = JSON.parse(await readFile(DB, 'utf8'));
const items = db.movies || [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(p, params = {}) {
  const url = new URL('https://api.themoviedb.org/3' + p);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
  url.searchParams.set('language', LANG);
  const headers = KEY.length > 60
    ? { Authorization: 'Bearer ' + KEY }
    : {};
  if (KEY.length <= 60) url.searchParams.set('api_key', KEY);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${p}`);
  return res.json();
}

let ok = 0, miss = 0;

for (const item of items) {
  const kind = item.type === 'series' ? 'tv' : 'movie';
  // 演唱会等非影视条目跳过
  if (item.type === 'concert') { console.log(`- 跳过（非影视）: ${item.title}`); continue; }

  try {
    // 优先用原名搜索，失败则用中文名
    let q = item.originalTitle || item.title;
    let data = await tmdb(`/search/${kind}`, { query: q, year: kind === 'movie' ? item.year : undefined, include_adult: 'false' });
    let hit = (data.results || [])[0];

    // 剧集用 first_air_date_year
    if (!hit && kind === 'tv') {
      data = await tmdb(`/search/${kind}`, { query: q, first_air_date_year: item.year });
      hit = (data.results || [])[0];
    }
    if (!hit && q !== item.title) {
      data = await tmdb(`/search/${kind}`, { query: item.title, year: kind === 'movie' ? item.year : undefined });
      hit = (data.results || [])[0];
    }
    if (!hit) {
      console.log(`! 未匹配: ${item.title} (${item.year})`);
      miss++;
      await sleep(120);
      continue;
    }

    // 详情（拿 runtime / genres / credits）
    const detail = await tmdb(`/${kind}/${hit.id}`, { append_to_response: 'credits' });
    const crew = (detail.credits && detail.credits.crew) || [];
    const cast = (detail.credits && detail.credits.cast) || [];

    item.rating = typeof detail.vote_average === 'number' ? Math.round(detail.vote_average * 10) / 10 : item.rating;
    item.votes = detail.vote_count || item.votes;
    item.overview = detail.overview || item.overview;
    item.tagline = detail.tagline || item.tagline;
    item.runtime = detail.runtime || (detail.episode_run_time && detail.episode_run_time[0]) || item.runtime;
    if (detail.genres && detail.genres.length) item.genres = detail.genres.map((g) => g.name);
    if (detail.production_countries && detail.production_countries.length) {
      item.country = detail.production_countries.map((c) => c.name).join(' / ');
    }
    if (detail.spoken_languages && detail.spoken_languages.length) {
      item.language = detail.spoken_languages.map((l) => l.name).join(' / ');
    }
    const dirs = crew.filter((c) => c.job === 'Director').map((c) => c.name);
    if (dirs.length) item.directors = [...new Set(dirs)];
    if (cast.length) item.cast = cast.slice(0, 6).map((c) => c.name);
    if (detail.poster_path) item.poster = `${IMG}/w500${detail.poster_path}`;
    if (detail.backdrop_path) item.backdrop = `${IMG}/w1280${detail.backdrop_path}`;

    console.log(`✓ ${item.title} → TMDB #${hit.id} · ${item.rating}分 · ${item.votes}票`);
    ok++;
  } catch (e) {
    console.log(`x 失败: ${item.title} — ${e.message}`);
    miss++;
  }
  await sleep(140); // 温和限速，避免触发 API 速率限制
}

db.updated = new Date().toISOString().slice(0, 10);
db.note = 'rating / votes / overview / poster / backdrop 由 TMDB API 自动补全。sources 一律为空数组。';
await writeFile(DB, JSON.stringify(db, null, 2) + '\n', 'utf8');

console.log(`\n完成：成功 ${ok} · 未匹配或失败 ${miss}`);
console.log('重新构建: npm run build');
