const TYPE_LABELS = { movie: '电影', series: '剧集', concert: '演唱会' };
const DEFAULT_QUALITY = ['4K', '1080P', '720P'];

export function validateData(db, cfg = {}, { qualityTiers = cfg.qualityOrder || DEFAULT_QUALITY } = {}) {
  const errors = [];
  const warnings = [];
  const movies = Array.isArray(db && db.movies) ? db.movies : [];
  const collections = Array.isArray(cfg.collections) ? cfg.collections : [];
  const collectionIds = new Set(collections.map((c) => c.id).filter(Boolean));
  const seenIds = new Set();
  const seenKeys = new Set();
  const maxYear = new Date().getFullYear() + 5;

  if (!db || !Array.isArray(db.movies)) errors.push('data/movies.json: movies 必须是数组');

  for (const [i, m] of movies.entries()) {
    const at = `movies[${i}]${m && m.id ? ` (${m.id})` : ''}`;
    if (!m || typeof m !== 'object') {
      errors.push(`${at}: 必须是对象`);
      continue;
    }
    if (typeof m.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.id)) {
      errors.push(`${at}: id 只能使用小写字母、数字和连字符`);
    } else if (seenIds.has(m.id)) {
      errors.push(`${at}: id 重复`);
    } else {
      seenIds.add(m.id);
    }
    if (typeof m.title !== 'string' || !m.title.trim()) errors.push(`${at}: 缺少 title`);
    if (!Number.isInteger(m.year) || m.year < 1888 || m.year > maxYear) errors.push(`${at}: year 应为 1888–${maxYear} 的整数`);
    if (!TYPE_LABELS[m.type]) errors.push(`${at}: type 必须是 movie / series / concert`);
    if (m.rating != null && (typeof m.rating !== 'number' || m.rating < 0 || m.rating > 10)) errors.push(`${at}: rating 应为 0–10 的数字或 null`);
    if (m.runtime != null && (!Number.isInteger(m.runtime) || m.runtime <= 0)) errors.push(`${at}: runtime 应为正整数（分钟）`);
    if (m.genres != null && (!Array.isArray(m.genres) || m.genres.some((g) => typeof g !== 'string' || !g.trim()))) errors.push(`${at}: genres 应为字符串数组`);
    for (const k of ['cast', 'directors']) {
      if (m[k] != null && !Array.isArray(m[k])) errors.push(`${at}: ${k} 应为数组`);
    }
    if (m.quality != null) {
      if (!Array.isArray(m.quality)) errors.push(`${at}: quality 应为数组`);
      else m.quality.forEach((q) => { if (!qualityTiers.includes(q)) warnings.push(`${at}: 规格 "${q}" 不在 qualityOrder 中`); });
    }
    if (m.collections != null) {
      if (!Array.isArray(m.collections)) errors.push(`${at}: collections 应为数组`);
      else m.collections.forEach((c) => { if (!collectionIds.has(c)) errors.push(`${at}: 合集 "${c}" 不存在`); });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.added || '') || Number.isNaN(Date.parse(m.added))) warnings.push(`${at}: added 应为 YYYY-MM-DD`);
    if (m.sources != null && !Array.isArray(m.sources)) errors.push(`${at}: sources 应为数组`);
    else (m.sources || []).forEach((s, j) => {
      if (!s || typeof s.url !== 'string' || !s.url) errors.push(`${at}: sources[${j}] 缺少 url`);
      else if (!/^https?:\/\//i.test(s.url)) errors.push(`${at}: sources[${j}] 的 url 必须使用 http(s)`);
    });
    if (m.poster && !/^(https?:\/\/|\/)/.test(m.poster)) warnings.push(`${at}: poster 建议使用 http(s) 地址或以 / 开头的站内路径`);
    if (m.backdrop && !/^(https?:\/\/|\/)/.test(m.backdrop)) warnings.push(`${at}: backdrop 建议使用 http(s) 地址或以 / 开头的站内路径`);

    const key = `${m.type}|${m.title}|${m.year}`;
    if (seenKeys.has(key)) warnings.push(`${at}: 与前面条目的 type + title + year 重复`);
    seenKeys.add(key);
  }

  collections.forEach((c, i) => {
    if (!c || typeof c.id !== 'string' || !c.id) errors.push(`collections[${i}]: 缺少 id`);
    if (!c || typeof c.name !== 'string' || !c.name) errors.push(`collections[${i}]: 缺少 name`);
    if (c && c.id) {
      const n = movies.filter((m) => (m.collections || []).includes(c.id)).length;
      if (n === 0) warnings.push(`合集 "${c.name || c.id}" 没有条目`);
    }
  });
  (cfg.featured || []).forEach((id) => { if (!seenIds.has(id)) warnings.push(`featured 中的 "${id}" 不存在`); });

  const internalHref = (href) => typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');

  if (typeof cfg.name !== 'string' || !cfg.name.trim()) errors.push('site.config.json: 缺少 name');
  if (!Array.isArray(cfg.nav) || !cfg.nav.length) {
    errors.push('site.config.json: nav 必须是非空数组');
  } else {
    cfg.nav.forEach((n, i) => {
      if (!n || typeof n.label !== 'string' || !n.label.trim()) errors.push(`site.config.json: nav[${i}] 缺少 label`);
      if (!n || !internalHref(n.href)) errors.push(`site.config.json: nav[${i}] 的 href 必须是以 / 开头的站内路径`);
    });
  }
  if (!cfg.footer || typeof cfg.footer !== 'object' || Array.isArray(cfg.footer)) {
    errors.push('site.config.json: 缺少 footer');
  } else {
    if (typeof cfg.footer.note !== 'string') errors.push('site.config.json: footer.note 应为字符串');
    if (typeof cfg.footer.copyright !== 'string' || !cfg.footer.copyright.trim()) errors.push('site.config.json: footer.copyright 不能为空');
    if (typeof cfg.footer.icp !== 'string' && cfg.footer.icp != null) errors.push('site.config.json: footer.icp 应为字符串');
    if (!Array.isArray(cfg.footer.columns)) {
      errors.push('site.config.json: footer.columns 应为数组');
    } else {
      cfg.footer.columns.forEach((c, i) => {
        if (!c || typeof c.title !== 'string' || !c.title.trim()) errors.push(`site.config.json: footer.columns[${i}] 缺少 title`);
        if (!c || !Array.isArray(c.links)) {
          errors.push(`site.config.json: footer.columns[${i}].links 应为数组`);
          return;
        }
        c.links.forEach((l, j) => {
          if (!l || typeof l.label !== 'string' || !l.label.trim()) errors.push(`site.config.json: footer.columns[${i}].links[${j}] 缺少 label`);
          if (!l || !internalHref(l.href)) errors.push(`site.config.json: footer.columns[${i}].links[${j}] 的 href 必须是以 / 开头的站内路径`);
        });
      });
    }
  }

  if (!/^https?:\/\//.test(cfg.url || '')) errors.push('site.config.json: url 必须是完整的 http(s) 地址');
  else if (/example\.(com|org|net)/.test(cfg.url)) warnings.push('site.config.json: url 仍是示例域名，部署前请改成真实域名');
  if (cfg.base && (!cfg.base.startsWith('/') || cfg.base.endsWith('/'))) warnings.push('site.config.json: base 应形如 "/films"，以 / 开头且不以 / 结尾');

  return { errors, warnings };
}
