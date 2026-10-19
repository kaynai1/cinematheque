// 光影档案 — 零依赖静态站点生成器
// 用法: node src/build.mjs   (输出到 site/)
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData } from './validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'site');

const cfg = JSON.parse(await readFile(path.join(root, 'data/site.config.json'), 'utf8'));
const db = JSON.parse(await readFile(path.join(root, 'data/movies.json'), 'utf8'));

const B = cfg.base || '';
const SITE_URL = String(cfg.url || '').replace(/\/+$/, '');
const link = (p) => B + p;
const absUrl = (u) => (/^https?:\/\//i.test(u) ? u : SITE_URL + link(u));
const canonicalFor = (rel) => (rel === 'index.html' ? `${SITE_URL}${B}/` : `${SITE_URL}${B}/${rel}`);

/* ---------- helpers ---------- */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const typeLabel = { movie: '电影', series: '剧集', concert: '演唱会' };
const typeDir = { movie: 'movie', series: 'series', concert: 'concert' };
const dirFor = (item) => typeDir[item.type] || 'movie';
const urlFor = (item) => `${dirFor(item)}/${item.id}.html`;
const relUrl = (item) => link('/' + urlFor(item));

const QUALITY_TIERS = cfg.qualityOrder || ['4K', '1080P', '720P'];
const topQuality = (item) => {
  const q = item.quality || [];
  for (const t of QUALITY_TIERS) if (q.includes(t)) return t;
  return q[0] || '';
};

const collMap = new Map((cfg.collections || []).map((c) => [c.id, c]));
const itemCollections = (item) => (item.collections || []).map((id) => collMap.get(id)).filter(Boolean);

const fmtRuntime = (m) => (m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`);
const ratingText = (r) => (typeof r === 'number' ? r.toFixed(1) : '—');

const byRating = (a, b) => (b.rating || 0) - (a.rating || 0);
const byYear = (a, b) => (b.year || 0) - (a.year || 0);
const byAdded = (a, b) => String(b.added || '').localeCompare(String(a.added || ''));

const items = (db.movies || []).slice();
const byId = new Map(items.map((i) => [i.id, i]));

const allGenres = [...new Set(items.flatMap((i) => i.genres || []))].sort((a, b) => a.localeCompare(b, 'zh'));

/* ---------- data validation ---------- */
const validation = validateData(db, cfg, { qualityTiers: QUALITY_TIERS });
validation.warnings.forEach((w) => console.warn(`! ${w}`));
if (validation.errors.length) {
  validation.errors.forEach((e) => console.error(`x ${e}`));
  console.error(`\n数据校验未通过：${validation.errors.length} 个错误，构建已中止。`);
  process.exit(1);
}

/* ---------- shared fragments ---------- */
function posterVars(item) {
  const h = hash(item.id);
  return `--ph:${h % 360};--ph2:${(h % 360 + 35 + ((h >> 9) % 90)) % 360};`;
}

function posterMarkup(item, { eager = false } = {}) {
  const q = topQuality(item);
  const img = item.poster
    ? `<img class="poster-img" src="${esc(item.poster)}" alt="${esc(item.title)} 海报" ${eager ? '' : 'loading="lazy"'} onerror="this.remove()">`
    : '';
  return `<div class="poster" style="${posterVars(item)}">
      ${img}
      <span class="poster-art" aria-hidden="true"><span class="poster-art-title">${esc(item.title)}</span></span>
      ${q ? `<span class="qbadge q-${esc(q.replace(/[^\w]/g, ''))}">${esc(q)}</span>` : ''}
    </div>`;
}

function card(item) {
  const genres = (item.genres || []).slice(0, 2).join(' / ');
  return `<article class="card" data-id="${esc(item.id)}" data-type="${esc(item.type)}"
    data-genres="${esc((item.genres || []).join('|'))}" data-quality="${esc((item.quality || []).join('|'))}"
    data-year="${esc(item.year)}" data-rating="${esc(item.rating ?? 0)}" data-added="${esc(item.added || '')}"
    data-title="${esc(item.title)}" data-original="${esc(item.originalTitle || '')}" data-cast="${esc((item.cast || []).join('|'))}"
    data-directors="${esc((item.directors || []).join('|'))}"
    data-collections="${esc((item.collections || []).join('|'))}">
    <a class="card-link" href="${relUrl(item)}" aria-label="${esc(item.title)}">
      ${posterMarkup(item)}
      <div class="card-body">
        <h3 class="card-title">${esc(item.title)}</h3>
        <p class="card-meta"><span class="card-year">${esc(item.year)}</span> · ${esc(genres)}</p>
        <div class="card-foot">
          <span class="score"><span class="score-num">${ratingText(item.rating)}</span><span class="score-max">/10</span></span>
          <span class="card-type">${esc(typeLabel[item.type] || item.type)}</span>
        </div>
      </div>
    </a>
    <button class="fav-btn" type="button" data-fav="${esc(item.id)}" aria-pressed="false" title="加入我的片单">
      <span class="fav-ico" aria-hidden="true"></span>
    </button>
  </article>`;
}

function grid(list, cls = '') {
  return `<div class="grid ${cls}" data-grid>${list.map(card).join('\n')}</div>`;
}

function emptyState(text) {
  return `<div class="empty" data-empty hidden><p>${esc(text)}</p></div>`;
}

function layout({ title, description, active = '', body, extraHead = '', image = '' }) {
  const fullTitle = title ? `${title} · ${cfg.name}` : `${cfg.name} — ${cfg.tagline}`;
  const desc = description || cfg.description;
  const social = image
    ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">`
    : '<meta name="twitter:card" content="summary">';
  const nav = cfg.nav
    .map((n) => `<a class="nav-link${active === n.label ? ' is-active' : ''}" href="${link(n.href)}">${esc(n.label)}</a>`)
    .join('');
  return `<!doctype html>
<html lang="${esc(cfg.lang)}" data-theme="dark" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(cfg.themeColor)}">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="__CANONICAL__">
${social}
<link rel="canonical" href="__CANONICAL__">
<link rel="icon" href="${link('/assets/favicon.svg')}" type="image/svg+xml">
<script>try{var t=JSON.parse(localStorage.getItem("archive.theme"));if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?"#f4f2ed":"#0b0b0d")}catch(e){}document.documentElement.classList.remove("no-js");setTimeout(function(){if(!window.__archiveReady){document.querySelectorAll(".reveal").forEach(function(e){e.classList.add("is-in")})}},2500);</script>
<link rel="stylesheet" href="${link('/assets/style.css')}">
${extraHead}
</head>
<body>
<a class="skip" href="#main">跳到主内容</a>
<header class="site-head">
  <div class="wrap head-inner">
    <a class="brand" href="${link('/index.html')}">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-text"><strong>${esc(cfg.name)}</strong><small>${esc(cfg.nameEn)}</small></span>
    </a>
    <nav class="nav" aria-label="主导航">${nav}</nav>
    <div class="head-tools">
      <a class="icon-btn" href="${link('/search.html')}" aria-label="搜索"><span class="ico-search" aria-hidden="true"></span></a>
      <button class="icon-btn" type="button" id="themeToggle" aria-label="切换明暗主题">
        <span class="ico-sun" aria-hidden="true"></span><span class="ico-moon" aria-hidden="true"></span>
      </button>
      <a class="icon-btn fav-count-btn" href="${link('/mylist.html')}" aria-label="我的片单">
        <span class="ico-fav" aria-hidden="true"></span><span class="fav-count" data-fav-count hidden>0</span>
      </a>
      <button class="icon-btn menu-btn" type="button" id="menuToggle" aria-label="展开导航" aria-expanded="false"><span></span></button>
    </div>
  </div>
</header>
<main id="main">${body}</main>
<footer class="site-foot">
  <div class="wrap foot-inner">
    <div class="foot-brand">
      <span class="brand-text"><strong>${esc(cfg.name)}</strong><small>${esc(cfg.nameEn)}</small></span>
      <p class="foot-note">${esc(cfg.footer.note)}</p>
    </div>
    <div class="foot-cols">
      ${cfg.footer.columns
        .map(
          (c) => `<div class="foot-col"><h4>${esc(c.title)}</h4><ul>${c.links
            .map((l) => `<li><a href="${link(l.href)}">${esc(l.label)}</a></li>`)
            .join('')}</ul></div>`
        )
        .join('')}
    </div>
  </div>
  <div class="wrap foot-bottom">
    <span>© ${new Date().getFullYear()} ${esc(cfg.footer.copyright)}</span>
    <span>资料更新于 ${esc(db.updated || '')}</span>
  </div>
</footer>
<script src="${link('/assets/data.js')}" defer></script>
<script src="${link('/assets/app.js')}" defer></script>
</body>
</html>`;
}

/* ---------- filter bar ---------- */
function filterBar({ types = [], genres = [], qualities = [], showSearch = true, count }) {
  const typeOpts = types.map((t) => `<option value="${esc(t)}">${esc(typeLabel[t] || t)}</option>`).join('');
  const genreOpts = genres.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  const qualOpts = qualities.map((q) => `<option value="${esc(q)}">${esc(q)}</option>`).join('');
  return `<div class="filters" data-filters>
    ${showSearch ? `<div class="f-search"><input type="search" data-search placeholder="搜索片名、原名、导演或演员…" aria-label="搜索"></div>` : ''}
    <div class="f-selects">
      ${typeOpts ? `<label class="f-field"><span>类型</span><select data-filter="type"><option value="">全部</option>${typeOpts}</select></label>` : ''}
      <label class="f-field"><span>题材</span><select data-filter="genre"><option value="">全部</option>${genreOpts}</select></label>
      <label class="f-field"><span>规格</span><select data-filter="quality"><option value="">全部</option>${qualOpts}</select></label>
      <label class="f-field"><span>排序</span><select data-sort>
        <option value="added">最近收录</option>
        <option value="rating">评分最高</option>
        <option value="year">年份最新</option>
        <option value="year-asc">年份最早</option>
        <option value="title">按拼音/片名</option>
      </select></label>
    </div>
    <p class="f-count"><strong data-count>${count}</strong> 部条目</p>
  </div>`;
}

/* ---------- pages ---------- */
function pageHome() {
  const featured = (cfg.featured || []).map((id) => byId.get(id)).filter(Boolean);
  const hero = featured[0];
  const latest = items.slice().sort(byAdded).slice(0, 12);
  const top = items.slice().sort(byRating).slice(0, 8);
  const counts = { movie: 0, series: 0, concert: 0 };
  items.forEach((i) => (counts[i.type] = (counts[i.type] || 0) + 1));

  const body = `
  <section class="hero"${hero ? ` style="${posterVars(hero)}"` : ''}>
    <div class="hero-glow" aria-hidden="true"></div>
    <div class="wrap hero-inner">
      <div class="hero-copy reveal">
        <p class="kicker">${esc(cfg.hero.kicker)}</p>
        <h1 class="hero-title">${esc(cfg.hero.title)}</h1>
        <p class="hero-text">${esc(cfg.hero.text)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="${link(cfg.hero.primary.href)}">${esc(cfg.hero.primary.label)}</a>
          <a class="btn btn-ghost" href="${link(cfg.hero.secondary.href)}">${esc(cfg.hero.secondary.label)}</a>
        </div>
        <dl class="hero-stats">
          <div><dt>收录条目</dt><dd>${items.length}</dd></div>
          <div><dt>电影</dt><dd>${counts.movie || 0}</dd></div>
          <div><dt>剧集</dt><dd>${counts.series || 0}</dd></div>
          <div><dt>演唱会</dt><dd>${counts.concert || 0}</dd></div>
          <div><dt>合集</dt><dd>${(cfg.collections || []).length}</dd></div>
        </dl>
      </div>
      ${
        featured.length
          ? `<div class="hero-panel reveal">
        <h2 class="panel-title">本期推荐</h2>
        <ul class="feature-list">
          ${featured
            .slice(0, 6)
            .map(
              (i) => `<li><a href="${relUrl(i)}">
              <span class="fl-title">${esc(i.title)}</span>
              <span class="fl-meta">${esc(i.year)} · ${esc(topQuality(i))} · <span class="fl-score">${ratingText(i.rating)}</span></span>
            </a></li>`
            )
            .join('')}
        </ul>
      </div>`
          : ''
      }
    </div>
  </section>

  <section class="wrap section reveal">
    <header class="sec-head">
      <h2>最新收录</h2>
      <a class="sec-more" href="${link('/latest.html')}">全部 →</a>
    </header>
    ${grid(latest)}
  </section>

  <section class="wrap section reveal">
    <header class="sec-head">
      <h2>高分推荐</h2>
      <a class="sec-more" href="${link('/ranking.html')}">完整榜单 →</a>
    </header>
    ${grid(top)}
  </section>

  <section class="wrap section reveal">
    <header class="sec-head"><h2>主题合集</h2><a class="sec-more" href="${link('/collections/index.html')}">全部合集 →</a></header>
    <div class="coll-grid">
      ${(cfg.collections || [])
        .map((c) => {
          const n = items.filter((i) => (i.collections || []).includes(c.id)).length;
          return `<a class="coll-card" href="${link(`/collections/${c.id}.html`)}" style="--ca:${esc(c.accent || cfg.accent)}">
            <span class="coll-short">${esc(c.short || c.name)}</span>
            <span class="coll-name">${esc(c.name)}</span>
            <span class="coll-desc">${esc(c.desc || '')}</span>
            <span class="coll-count">${n} 部</span>
          </a>`;
        })
        .join('')}
    </div>
  </section>

  <section class="wrap section reveal">
    <header class="sec-head"><h2>按题材浏览</h2></header>
    <div class="chip-row">
      ${allGenres.map((g) => `<a class="chip" href="${link('/list/index.html')}?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
    </div>
  </section>`;
  return layout({ title: '', active: '首页', body });
}

function pageList({ type = '', heading, sub, activeLabel }) {
  const list = type ? items.filter((i) => i.type === type) : items.slice();
  const sorted = list.slice().sort(byAdded);
  const genres = [...new Set(list.flatMap((i) => i.genres || []))].sort((a, b) => a.localeCompare(b, 'zh'));
  const quals = [...new Set(list.flatMap((i) => i.quality || []))].sort(
    (a, b) => QUALITY_TIERS.indexOf(a) - QUALITY_TIERS.indexOf(b)
  );
  const types = type ? [] : ['movie', 'series', 'concert'];
  const body = `
  <section class="wrap page-head reveal">
    <nav class="crumb"><a href="${link('/index.html')}">首页</a><span>/</span><span>${esc(heading)}</span></nav>
    <h1>${esc(heading)}</h1>
    ${sub ? `<p class="page-sub">${esc(sub)}</p>` : ''}
  </section>
  <section class="wrap reveal">
    ${filterBar({ types, genres, qualities: quals, count: sorted.length })}
    ${grid(sorted)}
    ${emptyState('没有匹配的条目，换个条件试试。')}
  </section>`;
  return layout({ title: heading, description: sub, active: activeLabel, body });
}

function pageCollectionsIndex() {
  const body = `
  <section class="wrap page-head reveal">
    <nav class="crumb"><a href="${link('/index.html')}">首页</a><span>/</span><span>合集</span></nav>
    <h1>主题合集</h1>
    <p class="page-sub">按系列与创作者整理的片单。</p>
  </section>
  <section class="wrap reveal">
    <div class="coll-grid coll-grid-lg">
      ${(cfg.collections || [])
        .map((c) => {
          const list = items.filter((i) => (i.collections || []).includes(c.id)).sort(byYear);
          return `<a class="coll-card" href="${link(`/collections/${c.id}.html`)}" style="--ca:${esc(c.accent || cfg.accent)}">
            <span class="coll-short">${esc(c.short || c.name)}</span>
            <span class="coll-name">${esc(c.name)}</span>
            <span class="coll-desc">${esc(c.desc || '')}</span>
            <span class="coll-count">${list.length} 部 · ${list.length ? `${list[list.length - 1].year}–${list[0].year}` : '待补充'}</span>
          </a>`;
        })
        .join('')}
    </div>
  </section>`;
  return layout({ title: '合集', body });
}

function pageCollection(id) {
  const c = collMap.get(id);
  if (!c) return null;
  const list = items.filter((i) => (i.collections || []).includes(id)).sort(byYear);
  const body = `
  <section class="wrap page-head reveal" style="--ca:${esc(c.accent || cfg.accent)}">
    <nav class="crumb"><a href="${link('/index.html')}">首页</a><span>/</span><a href="${link('/collections/index.html')}">合集</a><span>/</span><span>${esc(c.name)}</span></nav>
    <h1>${esc(c.name)}</h1>
    <p class="page-sub">${esc(c.desc || '')}</p>
  </section>
  <section class="wrap reveal">
    ${filterBar({ genres: [...new Set(list.flatMap((i) => i.genres || []))], qualities: [...new Set(list.flatMap((i) => i.quality || []))], count: list.length })}
    ${grid(list)}
    ${emptyState('这个合集暂无条目。')}
  </section>`;
  return layout({ title: c.name, description: c.desc, body });
}

function pageRanking() {
  const list = items.slice().sort(byRating).filter((i) => typeof i.rating === 'number');
  const body = `
  <section class="wrap page-head reveal">
    <nav class="crumb"><a href="${link('/index.html')}">首页</a><span>/</span><span>高分榜</span></nav>
    <h1>高分榜</h1>
    <p class="page-sub">按站内评分排序。评分来源见<a href="${link('/about.html#data')}">数据说明</a>。</p>
  </section>
  <section class="wrap reveal">
    <ol class="rank-list">
      ${list
        .map(
          (i, n) => `<li class="rank-item" data-id="${esc(i.id)}">
        <span class="rank-no">${String(n + 1).padStart(2, '0')}</span>
        <a class="rank-poster" href="${relUrl(i)}">${posterMarkup(i)}</a>
        <div class="rank-main">
          <h3><a href="${relUrl(i)}">${esc(i.title)}</a></h3>
          <p class="rank-meta">${esc(i.originalTitle || '')}${i.originalTitle ? ' · ' : ''}${esc(i.year)} · ${esc((i.genres || []).join(' / '))}</p>
          <p class="rank-overview">${esc((i.overview || '').slice(0, 90))}${(i.overview || '').length > 90 ? '…' : ''}</p>
          <p class="rank-cast">${esc((i.directors || []).join(' / '))}${i.cast && i.cast.length ? ` · 主演 ${esc(i.cast.slice(0, 3).join(' / '))}` : ''}</p>
        </div>
        <div class="rank-score"><strong>${ratingText(i.rating)}</strong><span>/10</span></div>
        <button class="fav-btn" type="button" data-fav="${esc(i.id)}" aria-pressed="false" title="加入我的片单"><span class="fav-ico" aria-hidden="true"></span></button>
      </li>`
        )
        .join('')}
    </ol>
  </section>`;
  return layout({ title: '高分榜', body });
}

function pageLatest() {
  const list = items.slice().sort(byAdded);
  const groups = new Map();
  list.forEach((i) => {
    const key = String(i.added || '').slice(0, 7) || '未标注';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const body = `
  <section class="wrap page-head reveal">
    <nav class="crumb"><a href="${link('/index.html')}">首页</a><span>/</span><span>最新收录</span></nav>
    <h1>最新收录</h1>
    <p class="page-sub">按入库时间倒序，共 ${list.length} 部。</p>
  </section>
  ${[...groups.entries()]
    .map(
      ([k, v]) => `<section class="wrap section reveal">
    <header class="sec-head sec-head-line"><h2>${esc(k)}</h2><span class="sec-count">${v.length} 部</span></header>
    ${grid(v)}
  </section>`
    )
    .join('')}`;
  return layout({ title: '最新收录', body });
}

function pageSearch() {
  const body = `
  <section class="wrap page-head reveal">
    <nav class="crumb"><a href="${link('/index.html')}">首页</a><span>/</span><span>搜索</span></nav>
    <h1>搜索片库</h1>
    <p class="page-sub">支持片名、原名、导演、演员与题材。</p>
  </section>
  <section class="wrap reveal">
    <div class="filters" data-filters>
      <div class="f-search f-search-lg"><input type="search" data-search placeholder="输入片名 / 演员 / 导演…" aria-label="搜索" autofocus></div>
      <p class="f-count"><strong data-count>${items.length}</strong> 部条目</p>
    </div>
    ${grid(items.slice().sort(byRating))}
    ${emptyState('没有找到相关条目。')}
  </section>`;
  return layout({ title: '搜索', body });
}

function pageMyList() {
  const body = `
  <section class="wrap page-head reveal">
    <nav class="crumb"><a href="${link('/index.html')}">首页</a><span>/</span><span>我的片单</span></nav>
    <h1>我的片单</h1>
    <p class="page-sub">只存在于这台设备的浏览器里，不会上传到任何服务器。</p>
  </section>
  <section class="wrap reveal">
    <div class="filters"><p class="f-count"><strong data-fav-total>0</strong> 部已收藏</p><button class="btn btn-ghost" type="button" data-fav-clear>清空片单</button></div>
    <div class="grid" data-fav-grid></div>
    ${emptyState('片单还是空的。在任意卡片右下角的书签按钮上点一下即可收藏。')}
  </section>`;
  return layout({ title: '我的片单', body });
}

function pageAbout() {
  const body = `
  <section class="wrap page-head reveal">
    <nav class="crumb"><a href="${link('/index.html')}">首页</a><span>/</span><span>站点说明</span></nav>
    <h1>站点说明</h1>
  </section>
  <section class="wrap prose reveal">
    <h2 id="copyright">版权声明</h2>
    <p>${esc(cfg.footer.note)}</p>
    <p>本站收录的片名、年份、演职员、海报等属于<strong>公开的作品信息与元数据</strong>，其著作权归各权利人所有。本站不提供、不链接、不索引任何影片文件或下载地址。</p>
    <p>如果你认为本站的某条信息侵犯了你的权益，请通过站点页脚的联系方式告知，我们会及时处理。</p>

    <h2 id="data">数据来源</h2>
    <p>条目元数据来自公开资料，可通过 TMDB / OMDb 等官方 API 自动补全与更新。运行 <code>npm run fetch:tmdb</code> 后会写入真实评分、海报与简介。</p>
    <p class="note">${esc(cfg.notice.data)}</p>

    <h2 id="sources">关于片源字段</h2>
    <p>每个条目的数据里都保留了一个 <code>sources</code> 字段，默认为空数组。它用于填写<strong>你本人拥有版权或已获正式授权</strong>的观看入口（例如自建服务、官方平台链接）。</p>
    <p class="note warn">${esc(cfg.notice.sources)}</p>

    <h2 id="deploy">如何部署</h2>
    <p>本站是纯静态站点，<code>npm run build</code> 之后把整个 <code>site/</code> 目录原样上传即可，无需数据库与后端。</p>
    <ul>
      <li><strong>Vercel / Netlify / Cloudflare Pages</strong>：仓库根目录设为 <code>site</code>，构建命令留空。</li>
      <li><strong>Nginx</strong>：把 <code>site/</code> 内容放到站点根目录，开启 <code>try_files $uri $uri/ =404;</code>。</li>
      <li><strong>本地预览</strong>：<code>npm run preview</code>，然后打开终端里打印的地址。</li>
    </ul>

    <h2 id="custom">改哪里</h2>
    <ul>
      <li>站名、导航、合集、页脚：<code>data/site.config.json</code></li>
      <li>条目数据：<code>data/movies.json</code></li>
      <li>视觉样式：<code>assets/style.css</code></li>
    </ul>
  </section>`;
  return layout({ title: '站点说明', body });
}

function pageDetail(item) {
  const cs = itemCollections(item);
  const genres = item.genres || [];
  const related = items
    .filter((x) => x.id !== item.id)
    .map((x) => {
      let s = 0;
      (x.genres || []).forEach((g) => genres.includes(g) && (s += 2));
      (x.collections || []).forEach((c) => (item.collections || []).includes(c) && (s += 6));
      (x.directors || []).forEach((d) => (item.directors || []).includes(d) && (s += 4));
      if (x.type === item.type) s += 1;
      return { x, s };
    })
    .filter((r) => r.s > 1)
    .sort((a, b) => b.s - a.s || byRating(a.x, b.x))
    .slice(0, 6)
    .map((r) => r.x);

  const ld = {
    '@context': 'https://schema.org',
    '@type': item.type === 'series' ? 'TVSeries' : 'Movie',
    name: item.title,
    alternateName: item.originalTitle || undefined,
    datePublished: String(item.year),
    genre: genres,
    director: (item.directors || []).map((n) => ({ '@type': 'Person', name: n })),
    actor: (item.cast || []).map((n) => ({ '@type': 'Person', name: n })),
    description: item.overview || undefined,
    aggregateRating:
      typeof item.rating === 'number'
        ? { '@type': 'AggregateRating', ratingValue: item.rating, bestRating: 10, ratingCount: item.votes || 1 }
        : undefined,
    image: item.poster || undefined,
  };
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c');

  const body = `
  <article class="wrap detail" style="${posterVars(item)}">
    <nav class="crumb reveal"><a href="${link('/index.html')}">首页</a><span>/</span><a href="${link(`/type/${item.type}.html`)}">${esc(typeLabel[item.type] || item.type)}</a><span>/</span><span>${esc(item.title)}</span></nav>

    <header class="detail-hero reveal">
      <div class="detail-backdrop" aria-hidden="true">${item.backdrop ? `<img src="${esc(item.backdrop)}" alt="" onerror="this.remove()">` : ''}</div>
      <div class="detail-poster">${posterMarkup(item, { eager: true })}</div>
      <div class="detail-head">
        <h1 class="detail-title">${esc(item.title)}</h1>
        ${item.originalTitle && item.originalTitle !== item.title ? `<p class="detail-orig">${esc(item.originalTitle)}</p>` : ''}
        <p class="detail-tagline">${esc(item.tagline || '')}</p>
        <div class="badge-row">
          <span class="pill">${esc(item.year)}</span>
          ${item.runtime ? `<span class="pill">${esc(fmtRuntime(item.runtime))}</span>` : ''}
          <span class="pill">${esc(typeLabel[item.type] || item.type)}</span>
          ${(item.quality || []).map((q) => `<span class="pill pill-q">${esc(q)}</span>`).join('')}
          ${item.country ? `<span class="pill pill-soft">${esc(item.country)}</span>` : ''}
          ${item.language ? `<span class="pill pill-soft">${esc(item.language)}</span>` : ''}
        </div>
        <div class="detail-actions">
          <button class="btn btn-primary" type="button" data-fav="${esc(item.id)}" aria-pressed="false">加入我的片单</button>
          <a class="btn btn-ghost" href="${link('/list/index.html')}">回到片库</a>
        </div>
      </div>
      <div class="detail-score">
        <strong>${ratingText(item.rating)}</strong>
        <span>/10</span>
        <small>${item.votes ? `${item.votes.toLocaleString('zh-CN')} 人评分` : '暂无评分'}</small>
      </div>
    </header>

    <div class="detail-body">
      <div class="detail-main reveal">
        <h2>简介</h2>
        <p class="detail-overview">${esc(item.overview || '暂无简介。')}</p>

        <h2>题材</h2>
        <div class="chip-row">
          ${genres.map((g) => `<a class="chip" href="${link('/list/index.html')}?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
        </div>

        <h2>演职员</h2>
        <dl class="credits">
          <div><dt>导演</dt><dd>${(item.directors || []).map(esc).join(' / ') || '—'}</dd></div>
          <div><dt>主演</dt><dd>${(item.cast || []).map(esc).join(' / ') || '—'}</dd></div>
        </dl>

        ${
          cs.length
            ? `<h2>所属合集</h2><div class="chip-row">${cs
                .map((c) => `<a class="chip chip-strong" href="${link(`/collections/${c.id}.html`)}">${esc(c.name)}</a>`)
                .join('')}</div>`
            : ''
        }

        <h2 id="sources">观看入口</h2>
        ${
          item.sources && item.sources.length
            ? `<ul class="source-list">${item.sources
                .map(
                  (s) =>
                    `<li><a href="${esc(s.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(s.label || s.url)}</a>${s.note ? `<span>${esc(s.note)}</span>` : ''}</li>`
                )
                .join('')}</ul>`
            : `<p class="note">本条目没有填写观看入口。该字段只允许填入拥有版权或已获授权的地址。</p>`
        }
        <p class="note small">本站不存储、不提供、不传播任何影片文件。</p>
      </div>

      <aside class="detail-side reveal">
        <h2>资料</h2>
        <dl class="kv">
          <div><dt>上映年份</dt><dd>${esc(item.year)}</dd></div>
          <div><dt>类型</dt><dd>${esc(typeLabel[item.type] || item.type)}</dd></div>
          <div><dt>片长</dt><dd>${esc(item.runtime ? fmtRuntime(item.runtime) : '—')}</dd></div>
          <div><dt>规格</dt><dd>${esc((item.quality || []).join(' / ') || '—')}</dd></div>
          <div><dt>地区</dt><dd>${esc(item.country || '—')}</dd></div>
          <div><dt>语言</dt><dd>${esc(item.language || '—')}</dd></div>
          <div><dt>收录日期</dt><dd>${esc(item.added || '—')}</dd></div>
          <div><dt>条目编号</dt><dd><code>${esc(item.id)}</code></dd></div>
        </dl>
      </aside>
    </div>

    ${
      related.length
        ? `<section class="section reveal"><header class="sec-head"><h2>相关推荐</h2></header>${grid(related)}</section>`
        : ''
    }
  </article>
  <script type="application/ld+json">${ldJson}</script>`;
  return layout({ title: item.title, description: item.overview, body, image: item.poster ? absUrl(item.poster) : '' });
}

/* ---------- build ---------- */
async function writePage(rel, html) {
  const f = path.join(OUT, rel);
  await mkdir(path.dirname(f), { recursive: true });
  html = html.replaceAll('__CANONICAL__', esc(canonicalFor(rel)));
  await writeFile(f, html, 'utf8');
  return rel;
}

async function build() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const written = [];

  written.push(await writePage('index.html', pageHome()));
  written.push(await writePage('list/index.html', pageList({ heading: '全部影片', sub: '站内收录的全部条目，可按类型、题材、规格筛选。', activeLabel: '全部影片' })));
  for (const t of ['movie', 'series', 'concert']) {
    const n = items.filter((i) => i.type === t).length;
    if (!n) continue;
    written.push(
      await writePage(
        `type/${t}.html`,
        pageList({ type: t, heading: typeLabel[t], sub: `共 ${n} 部${typeLabel[t]}。`, activeLabel: typeLabel[t] })
      )
    );
  }
  written.push(await writePage('collections/index.html', pageCollectionsIndex()));
  for (const c of cfg.collections || []) {
    const html = pageCollection(c.id);
    if (html) written.push(await writePage(`collections/${c.id}.html`, html));
  }
  written.push(await writePage('ranking.html', pageRanking()));
  written.push(await writePage('latest.html', pageLatest()));
  written.push(await writePage('search.html', pageSearch()));
  written.push(await writePage('mylist.html', pageMyList()));
  written.push(await writePage('about.html', pageAbout()));

  for (const item of items) {
    written.push(await writePage(`${dirFor(item)}/${item.id}.html`, pageDetail(item)));
  }

  // assets
  await mkdir(path.join(OUT, 'assets'), { recursive: true });
  await cp(path.join(root, 'assets/style.css'), path.join(OUT, 'assets/style.css'));
  await cp(path.join(root, 'assets/app.js'), path.join(OUT, 'assets/app.js'));

  // search index for the client
  const index = items.map((i) => ({
    id: i.id,
    t: i.title,
    o: i.originalTitle || '',
    y: i.year,
    ty: i.type,
    g: i.genres || [],
    q: i.quality || [],
    r: i.rating ?? 0,
    d: (i.directors || []).join(' '),
    c: (i.cast || []).join(' '),
    u: urlFor(i),
  }));
  await writeFile(
    path.join(OUT, 'assets/data.js'),
    `window.__ARCHIVE__=${JSON.stringify({ name: cfg.name, accent: cfg.accent, base: B, items: index })};\n`,
    'utf8'
  );

  await writeFile(
    path.join(OUT, 'assets/favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b0b0d"/><rect x="7" y="9" width="18" height="13" rx="2.5" fill="none" stroke="#e6b35a" stroke-width="2"/><path d="M12 22l3.2-4.6 2.6 3.2 1.8-2.2 2.4 3.6z" fill="#e6b35a"/><circle cx="12.5" cy="13.5" r="1.6" fill="#e6b35a"/></svg>`,
    'utf8'
  );

  // deploy extras
  await writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}${B}/sitemap.xml\n`, 'utf8');
  const urls = ['index.html', 'list/index.html', 'ranking.html', 'latest.html', 'about.html', 'collections/index.html', ...written.filter((w) => w !== 'index.html')];
  const lastmod = db.updated || new Date().toISOString().slice(0, 10);
  const sitemapUrls = [...new Set(urls)].filter((u) => !['search.html', 'mylist.html', '404.html'].includes(u));
  await writeFile(
    path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
      .map((u) => `  <url><loc>${esc(canonicalFor(u))}</loc><lastmod>${esc(lastmod)}</lastmod></url>`)
      .join('\n')}\n</urlset>\n`,
    'utf8'
  );
  await writePage('404.html', layout({ title: '页面不存在', body: '<section class="wrap page-head"><h1>404</h1><p class="page-sub">这个页面不存在。<a href="' + link('/index.html') + '">回到首页</a></p></section>' }));

  console.log(`✓ 生成 ${new Set(written).size} 个页面 → site/`);
  console.log(`  条目 ${items.length} · 合集 ${(cfg.collections || []).length}`);
}

await build();
