(() => {
  'use strict';

  const TYPE_LABEL = { movie: '电影', series: '剧集', concert: '演唱会' };
  const KEY_STORAGE = 'cinematheque.admin.tmdbKey';
  const BULK_PAGE_KEY = 'cinematheque.admin.bulkPages';
  const BULK_LISTS = {
    movie: [['popular', '热门'], ['top_rated', '高分'], ['now_playing', '正在上映'], ['upcoming', '即将上映']],
    tv: [['popular', '热门'], ['top_rated', '高分'], ['airing_today', '今日播出'], ['on_the_air', '正在播出']],
  };
  const DETAIL_DELAY = 220;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bulkListLabel = (type, list) => {
    const found = (BULK_LISTS[type] || []).find(([value]) => value === list);
    return found ? found[1] : list;
  };

  function readStoredKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
  }

  function readBulkPages() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BULK_PAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  const state = {
    movies: [],
    collections: [],
    qualityTiers: [],
    previewUrl: 'http://127.0.0.1:4173',
    site: {},
    meta: {},
    mode: null,
    selectedId: null,
    dirty: false,
    saving: false,
    view: 'library',
    tmdbKey: readStoredKey(),
    siteConfig: null,
    siteDirty: false,
    siteSaving: false,
    bulkBusy: false,
    bulkCancel: false,
    bulkDrafts: [],
    bulkStats: { imported: 0, skipped: 0, failed: 0 },
    bulkRun: null,
    bulkPages: readBulkPages(),
  };

  const els = {};
  let toastTimer = 0;

  const fieldEl = (name) => els.form.elements.namedItem(name);
  const val = (name) => {
    const el = fieldEl(name);
    return el ? String(el.value).trim() : '';
  };
  const setVal = (name, value) => {
    const el = fieldEl(name);
    if (el) el.value = value === undefined || value === null ? '' : String(value);
  };
  const joinList = (list) => (Array.isArray(list) ? list.filter(Boolean).join(', ') : '');
  const splitList = (text) => {
    const out = [];
    String(text || '').split(/[,，、]/).forEach((part) => {
      const value = part.trim();
      if (value && !out.includes(value)) out.push(value);
    });
    return out;
  };

  document.addEventListener('DOMContentLoaded', boot);

  function boot() {
    cacheEls();
    els.tmdbKey.value = state.tmdbKey;
    els.bulkKey.value = state.tmdbKey;
    renderBulkLists();
    updateBulkControls();
    wireEvents();
    updateView();
    syncTopbarHeight();
    loadData();
  }

  function syncTopbarHeight() {
    if (!els.topbar) return;
    document.documentElement.style.setProperty('--topbar-h', `${els.topbar.offsetHeight}px`);
  }

  function cacheEls() {
    Object.assign(els, {
      topbar: $('.topbar'),
      tabLibrary: $('#tabLibrary'),
      tabBulk: $('#tabBulk'),
      tabSite: $('#tabSite'),
      libraryView: $('#libraryView'),
      bulkView: $('#bulkView'),
      siteView: $('#siteView'),
      state: $('#state'),
      previewLink: $('#previewLink'),
      btnBuild: $('#btnBuild'),
      btnSave: $('#btnSave'),
      btnNew: $('#btnNew'),
      countText: $('#countText'),
      listSearch: $('#listSearch'),
      listType: $('#listType'),
      movieList: $('#movieList'),
      empty: $('#empty'),
      form: $('#editor'),
      editorKind: $('#editorKind'),
      editorTitle: $('#editorTitle'),
      editorMeta: $('#editorMeta'),
      messages: $('#messages'),
      qualityBox: $('#qualityBox'),
      collectionBox: $('#collectionBox'),
      sourceList: $('#sourceList'),
      sourceEmpty: $('#sourceEmpty'),
      btnDelete: $('#btnDelete'),
      btnAddSource: $('#btnAddSource'),
      btnDiscard: $('#btnDiscard'),
      btnSaveBottom: $('#btnSaveBottom'),
      btnSaveBottom2: $('#btnSaveBottom2'),
      btnSlug: $('#btnSlug'),
      posterPreview: $('#posterPreview'),
      posterFallback: $('#posterFallback'),
      backdropPreview: $('#backdropPreview'),
      backdropFallback: $('#backdropFallback'),
      tmdbKey: $('#tmdbKey'),
      tmdbQuery: $('#tmdbQuery'),
      tmdbStatus: $('#tmdbStatus'),
      tmdbResults: $('#tmdbResults'),
      btnForgetKey: $('#btnForgetKey'),
      btnTmdbSearch: $('#btnTmdbSearch'),
      toast: $('#toast'),
      bottomHint: $('#bottomHint'),
      siteForm: $('#siteForm'),
      siteMessages: $('#siteMessages'),
      footerCols: $('#footerCols'),
      btnAddFooterCol: $('#btnAddFooterCol'),
      btnCancelSite: $('#btnCancelSite'),
      btnSaveSite: $('#btnSaveSite'),
      siteStatus: $('#siteStatus'),
      bulkForm: $('#bulkForm'),
      bulkKey: $('#bulkKey'),
      btnBulkForgetKey: $('#btnBulkForgetKey'),
      bulkType: $('#bulkType'),
      bulkList: $('#bulkList'),
      bulkPage: $('#bulkPage'),
      bulkCount: $('#bulkCount'),
      btnBulkStart: $('#btnBulkStart'),
      btnBulkCancel: $('#btnBulkCancel'),
      bulkMessages: $('#bulkMessages'),
      bulkProgressCard: $('#bulkProgressCard'),
      bulkCounts: $('#bulkCounts'),
      bulkProgress: $('#bulkProgress'),
      bulkBar: $('#bulkBar'),
      bulkStatus: $('#bulkStatus'),
      bulkLog: $('#bulkLog'),
      bulkDraftCard: $('#bulkDraftCard'),
      bulkDraftCount: $('#bulkDraftCount'),
      btnBulkDiscard: $('#btnBulkDiscard'),
      btnBulkSave: $('#btnBulkSave'),
    });
    els.librarySaveButtons = [els.btnSaveBottom, els.btnSaveBottom2];
  }

  async function api(path, options = {}) {
    const init = { cache: 'no-store', ...options };
    if (options.body) init.headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const error = new Error((data && data.error) || `请求失败（${res.status}）`);
      error.status = res.status;
      error.errors = (data && data.errors) || [];
      error.warnings = (data && data.warnings) || [];
      throw error;
    }
    return data || {};
  }

  async function loadData() {
    try {
      const data = await api('/api/data');
      state.movies = Array.isArray(data.movies) ? data.movies : [];
      state.collections = data.collections || [];
      state.qualityTiers = data.qualityTiers || ['4K', '1080P', '720P'];
      state.previewUrl = data.previewUrl || state.previewUrl;
      state.site = data.site || {};
      state.meta = data.meta || {};
      els.previewLink.href = state.previewUrl;
      if (state.meta.updated) {
        els.bottomHint.textContent = `上次更新 ${state.meta.updated} · 保存前自动备份 · 保存后自动构建`;
      }
      renderChoices();
      renderList();
      if (state.movies.length) selectMovie(state.movies[0].id, { force: true });
      else showEmpty();
      setState('就绪');
    } catch (error) {
      setState('加载失败', 'error');
      showMessages([error.message], []);
    }
  }

  function wireEvents() {
    els.tabLibrary.addEventListener('click', () => setView('library'));
    els.tabBulk.addEventListener('click', () => setView('bulk'));
    els.tabSite.addEventListener('click', () => setView('site'));
    els.bulkForm.addEventListener('submit', startBulkImport);
    els.btnBulkCancel.addEventListener('click', cancelBulkImport);
    els.btnBulkSave.addEventListener('click', () => saveBulkDrafts());
    els.btnBulkDiscard.addEventListener('click', discardBulkDrafts);
    els.btnBulkForgetKey.addEventListener('click', forgetBulkKey);
    els.bulkType.addEventListener('change', renderBulkLists);
    els.bulkList.addEventListener('change', syncBulkPage);
    els.listSearch.addEventListener('input', renderList);
    els.listType.addEventListener('change', renderList);
    els.btnNew.addEventListener('click', () => newMovie());
    els.btnSave.addEventListener('click', saveActive);
    els.btnSaveBottom.addEventListener('click', save);
    els.btnSaveBottom2.addEventListener('click', save);
    els.btnDelete.addEventListener('click', deleteCurrent);
    els.btnBuild.addEventListener('click', rebuild);
    els.btnCancelSite.addEventListener('click', discardSiteChanges);
    els.btnAddFooterCol.addEventListener('click', () => { addFooterColumn(); markSiteDirty(); });
    els.footerCols.addEventListener('click', onFooterColsClick);
    els.siteForm.addEventListener('input', onSiteChange);
    els.siteForm.addEventListener('change', onSiteChange);
    els.siteForm.addEventListener('submit', (event) => { event.preventDefault(); saveSite(); });
    els.btnAddSource.addEventListener('click', () => { addSourceRow(); updateSourceEmpty(); markDirty(); });
    els.btnDiscard.addEventListener('click', discardChanges);
    els.btnSlug.addEventListener('click', generateSlug);
    els.form.addEventListener('submit', (event) => { event.preventDefault(); save(); });
    els.form.addEventListener('input', onEditorChange);
    els.form.addEventListener('change', onEditorChange);
    els.btnForgetKey.addEventListener('click', forgetTmdbKey);
    els.btnTmdbSearch.addEventListener('click', searchTmdb);
    els.tmdbQuery.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); searchTmdb(); }
    });
    els.posterPreview.addEventListener('error', () => {
      els.posterPreview.hidden = true;
      els.posterFallback.hidden = false;
      els.posterFallback.textContent = '图片加载失败';
    });
    els.backdropPreview.addEventListener('error', () => {
      els.backdropPreview.hidden = true;
      els.backdropFallback.hidden = false;
      els.backdropFallback.textContent = '图片加载失败';
    });
    window.addEventListener('beforeunload', (event) => {
      if (!state.dirty && !state.siteDirty && !state.bulkBusy && !state.bulkDrafts.length) return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('resize', syncTopbarHeight);
    if ('ResizeObserver' in window) new ResizeObserver(syncTopbarHeight).observe(els.topbar);
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        if (state.view === 'site') {
          event.preventDefault();
          saveSite();
          return;
        }
        if (state.view === 'bulk') {
          event.preventDefault();
          if (state.bulkBusy) return;
          if (state.bulkDrafts.length) saveBulkDrafts();
          else startBulkImport();
          return;
        }
        if (!state.mode) return;
        event.preventDefault();
        save();
      }
    });
  }

  /* ---------- views ---------- */
  function setView(view) {
    if (view === state.view) return;
    if (state.bulkBusy) {
      toast('导入进行中，完成或取消后才能切换栏目。', 'error');
      return;
    }
    state.view = view;
    updateView();
    if (!state.saving && !state.siteSaving) {
      if (view === 'bulk') {
        const pending = state.bulkDrafts.length > 0;
        setState(pending ? '有待保存条目' : '就绪', pending ? 'warn' : '');
      } else {
        const dirty = view === 'site' ? state.siteDirty : state.dirty;
        setState(dirty ? '未保存' : '就绪', dirty ? 'warn' : '');
      }
    }
    if (view === 'site') ensureSiteLoaded();
    window.scrollTo(0, 0);
  }

  function updateView() {
    const isLibrary = state.view === 'library';
    const isBulk = state.view === 'bulk';
    const isSite = state.view === 'site';
    els.libraryView.hidden = !isLibrary;
    els.bulkView.hidden = !isBulk;
    els.siteView.hidden = !isSite;
    [
      [els.tabLibrary, isLibrary],
      [els.tabBulk, isBulk],
      [els.tabSite, isSite],
    ].forEach(([tab, active]) => {
      tab.classList.toggle('is-active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    els.btnSave.hidden = isBulk;
    els.btnSave.textContent = isSite ? '保存设置并构建' : '保存并构建';
    updateSaveButtons();
    syncTopbarHeight();
  }

  function saveActive() {
    if (state.view === 'site') saveSite();
    else save();
  }

  function onEditorChange(event) {
    if (!state.mode) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('.tmdb-card')) return;
    markDirty();
    const name = target.getAttribute('name');
    if (name === 'poster' || name === 'backdrop') updatePreviews();
    if (['title', 'originalTitle', 'id', 'year', 'type'].includes(name)) updateHeader();
  }

  function renderChoices() {
    els.qualityBox.replaceChildren();
    state.qualityTiers.forEach((quality) => els.qualityBox.append(makeChoice(quality, quality, 'quality')));
    els.collectionBox.replaceChildren();
    if (!state.collections.length) {
      const empty = document.createElement('span');
      empty.className = 'muted small';
      empty.textContent = 'site.config.json 中还没有合集';
      els.collectionBox.append(empty);
      return;
    }
    state.collections.forEach((collection) => els.collectionBox.append(makeChoice(collection.name, collection.id, 'collection')));
  }

  function makeChoice(label, value, kind) {
    const wrapper = document.createElement('label');
    wrapper.className = 'chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.dataset.kind = kind;
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.append(input, text);
    return wrapper;
  }

  function renderList() {
    if (!els.movieList) return;
    const query = els.listSearch.value.trim().toLowerCase();
    const type = els.listType.value;
    const filtered = state.movies.filter((movie) => {
      if (type && movie.type !== type) return false;
      if (!query) return true;
      return [movie.title, movie.originalTitle, movie.id]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });

    els.movieList.replaceChildren();
    filtered.forEach((movie) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'movie-item';
      item.dataset.id = movie.id;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', state.mode === 'edit' && state.selectedId === movie.id ? 'true' : 'false');

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (movie.poster) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = movie.poster;
        img.addEventListener('error', () => img.remove());
        thumb.append(img);
      } else {
        thumb.textContent = (movie.title || '?').trim().slice(0, 1) || '?';
      }

      const copy = document.createElement('div');
      copy.className = 'item-copy';
      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = movie.title || '(未命名)';
      const meta = document.createElement('div');
      meta.className = 'item-meta';
      meta.textContent = [movie.year, TYPE_LABEL[movie.type]].filter(Boolean).join(' · ');
      copy.append(title, meta);
      item.append(thumb, copy);
      item.addEventListener('click', () => selectMovie(movie.id));
      els.movieList.append(item);
    });

    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = state.movies.length ? '没有匹配的条目。' : '还没有条目，点击「新建」开始。';
      els.movieList.append(empty);
    }

    const total = state.movies.length;
    els.countText.textContent = query || type ? `${filtered.length} / ${total} 条` : `${total} 条`;
    updateSaveButtons();
  }

  function updateSaveButtons() {
    const busy = state.saving || state.siteSaving || state.bulkBusy;
    const libraryDisabled = busy || !state.mode;
    const siteDisabled = busy || !state.siteConfig;
    els.librarySaveButtons.forEach((button) => { button.disabled = libraryDisabled; });
    els.btnSave.hidden = state.view === 'bulk';
    els.btnSave.disabled = state.view === 'site' ? siteDisabled : libraryDisabled;
    els.btnSaveSite.disabled = siteDisabled;
    els.btnBuild.disabled = busy;
    els.btnNew.disabled = busy;
    els.btnDelete.disabled = busy || state.mode !== 'edit';
    updateBulkControls();
  }

  function setSaving(saving) {
    state.saving = saving;
    document.body.classList.toggle('saving', saving);
    updateSaveButtons();
  }

  function selectMovie(id, options = {}) {
    if (!id) return;
    if (!options.force && state.mode === 'edit' && state.selectedId === id) return;
    if (!options.force && state.dirty && !confirm('当前修改尚未保存，确定放弃并切换条目？')) return;
    const movie = state.movies.find((item) => item.id === id);
    if (!movie) return;
    state.mode = 'edit';
    state.selectedId = id;
    fillForm(movie);
    state.dirty = false;
    renderList();
    hideMessages();
    clearTmdbResults();
    setState('就绪');
    const item = Array.from(els.movieList.children).find((node) => node.dataset.id === id);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  function newMovie(options = {}) {
    if (state.saving) return false;
    if (!options.force && state.dirty && !confirm('当前修改尚未保存，确定放弃并新建？')) return false;
    state.mode = 'new';
    state.selectedId = null;
    const draft = {
      id: `entry-${Date.now().toString(36)}`,
      title: '',
      originalTitle: '',
      year: new Date().getFullYear(),
      type: 'movie',
      genres: [],
      runtime: null,
      rating: null,
      votes: null,
      country: '',
      language: '',
      directors: [],
      cast: [],
      tagline: '',
      overview: '',
      quality: [],
      collections: [],
      added: today(),
      poster: '',
      backdrop: '',
      sources: [],
      tmdbId: null,
    };
    fillForm(draft);
    state.dirty = false;
    renderList();
    hideMessages();
    clearTmdbResults();
    setState('新建条目');
    const titleInput = fieldEl('title');
    if (titleInput) { titleInput.focus(); titleInput.select?.(); }
    els.form.scrollIntoView({ block: 'start' });
    return true;
  }

  function fillForm(movie) {
    els.empty.hidden = true;
    els.form.hidden = false;
    setVal('title', movie.title || '');
    setVal('originalTitle', movie.originalTitle || '');
    setVal('id', movie.id || '');
    setVal('year', movie.year ?? '');
    setVal('type', movie.type || 'movie');
    setVal('rating', movie.rating ?? '');
    setVal('votes', movie.votes ?? '');
    setVal('runtime', movie.runtime ?? '');
    setVal('added', movie.added || today());
    setVal('genres', joinList(movie.genres));
    setVal('country', movie.country || '');
    setVal('language', movie.language || '');
    setVal('tagline', movie.tagline || '');
    setVal('overview', movie.overview || '');
    setVal('poster', movie.poster || '');
    setVal('backdrop', movie.backdrop || '');
    setVal('directors', joinList(movie.directors));
    setVal('cast', joinList(movie.cast));
    setVal('tmdbId', movie.tmdbId || '');

    const selectedQuality = new Set(Array.isArray(movie.quality) ? movie.quality : []);
    $$('input[data-kind="quality"]', els.qualityBox).forEach((input) => {
      input.checked = selectedQuality.has(input.value);
    });
    const selectedCollections = new Set(Array.isArray(movie.collections) ? movie.collections : []);
    $$('input[data-kind="collection"]', els.collectionBox).forEach((input) => {
      input.checked = selectedCollections.has(input.value);
    });

    els.sourceList.replaceChildren();
    if (Array.isArray(movie.sources)) movie.sources.forEach((source) => addSourceRow(source));
    updateSourceEmpty();
    updateHeader();
    updatePreviews();
    updateSaveButtons();
  }

  function addSourceRow(source = {}) {
    const row = document.createElement('div');
    row.className = 'source-row';
    const fields = [
      ['label', '平台 / 名称', source.label || ''],
      ['url', 'https://…', source.url || ''],
      ['note', '备注：清晰度、字幕等', source.note || ''],
    ];
    fields.forEach(([key, placeholder, value]) => {
      const input = document.createElement('input');
      input.type = key === 'url' ? 'url' : 'text';
      input.dataset.field = key;
      input.placeholder = placeholder;
      input.setAttribute('aria-label', placeholder);
      input.value = value;
      row.append(input);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small ghost danger';
    remove.textContent = '移除';
    remove.addEventListener('click', () => {
      row.remove();
      updateSourceEmpty();
      markDirty();
    });
    row.append(remove);
    els.sourceList.append(row);
    updateSourceEmpty();
  }

  function updateSourceEmpty() {
    els.sourceEmpty.hidden = els.sourceList.children.length > 0;
  }

  function updateHeader() {
    if (!state.mode) return;
    els.editorKind.textContent = state.mode === 'new' ? '新建条目' : '编辑条目';
    els.editorTitle.textContent = val('title') || '未命名条目';
    els.editorMeta.textContent = [val('id'), TYPE_LABEL[val('type')], val('year')].filter(Boolean).join(' · ');
  }

  function previewSrc(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/')) return state.previewUrl.replace(/\/+$/, '') + value;
    return '';
  }

  function updatePreview(img, fallback, raw) {
    const src = previewSrc(raw);
    if (!src) {
      img.hidden = true;
      img.removeAttribute('src');
      fallback.hidden = false;
      fallback.textContent = raw ? '地址需以 http(s) 或 / 开头' : '暂无预览';
      return;
    }
    img.hidden = false;
    fallback.hidden = true;
    if (img.getAttribute('src') !== src) img.src = src;
  }

  function updatePreviews() {
    updatePreview(els.posterPreview, els.posterFallback, val('poster'));
    updatePreview(els.backdropPreview, els.backdropFallback, val('backdrop'));
  }

  function markDirty() {
    if (!state.mode) return;
    if (!state.dirty) {
      state.dirty = true;
      setState('未保存', 'warn');
    }
  }

  function intField(name, errors, label, options = {}) {
    const { min = -Infinity, max = Infinity, required = false } = options;
    const raw = val(name);
    if (!raw) {
      if (required) errors.push(`${label}不能为空`);
      return null;
    }
    const number = Number(raw);
    if (!Number.isInteger(number) || number < min || number > max) {
      errors.push(`${label}格式不正确`);
      return null;
    }
    return number;
  }

  function readForm() {
    const errors = [];
    const original = state.mode === 'edit' ? state.movies.find((movie) => movie.id === state.selectedId) : null;
    const movie = original ? clone(original) : {};
    const id = val('id').toLowerCase();
    const title = val('title');
    const type = val('type');
    const year = intField('year', errors, '年份', { min: 1888, max: new Date().getFullYear() + 5, required: true });
    const runtime = intField('runtime', errors, '时长', { min: 1 });
    const votes = intField('votes', errors, '票数', { min: 0 });
    const tmdbId = intField('tmdbId', errors, 'TMDB ID', { min: 1 });
    const added = val('added') || today();

    let rating = null;
    const ratingRaw = val('rating');
    if (ratingRaw) {
      const number = Number(ratingRaw);
      if (!Number.isFinite(number) || number < 0 || number > 10) errors.push('评分应在 0–10 之间');
      else rating = Math.round(number * 10) / 10;
    }

    if (!id) errors.push('ID 不能为空');
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) errors.push('ID 只能使用小写字母、数字和连字符');
    else if (state.movies.some((item) => item.id === id && !(original && item.id === original.id))) {
      errors.push(`ID "${id}" 已被其他条目使用`);
    }
    if (!title) errors.push('片名不能为空');
    if (!TYPE_LABEL[type]) errors.push('类型无效');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(added)) errors.push('收录日期格式应为 YYYY-MM-DD');

    const sources = [];
    $$('.source-row', els.sourceList).forEach((row, index) => {
      const get = (key) => row.querySelector(`[data-field="${key}"]`).value.trim();
      const label = get('label');
      const url = get('url');
      const note = get('note');
      if (!label && !url && !note) return;
      if (!url) errors.push(`片源第 ${index + 1} 行缺少链接`);
      else if (!/^https?:\/\//i.test(url)) errors.push(`片源第 ${index + 1} 行的链接必须以 http(s) 开头`);
      sources.push({ label: label || url, url, note });
    });

    const quality = $$('input[data-kind="quality"]:checked', els.qualityBox).map((input) => input.value);
    const collections = $$('input[data-kind="collection"]:checked', els.collectionBox).map((input) => input.value);
    const next = {
      ...movie,
      id,
      title,
      originalTitle: val('originalTitle'),
      year: year ?? undefined,
      type,
      genres: splitList(val('genres')),
      runtime: runtime ?? null,
      rating,
      votes: votes ?? null,
      country: val('country'),
      language: val('language'),
      directors: splitList(val('directors')),
      cast: splitList(val('cast')),
      tagline: val('tagline'),
      overview: val('overview'),
      quality,
      collections,
      added,
      poster: val('poster'),
      backdrop: val('backdrop'),
      sources,
    };
    if (tmdbId) next.tmdbId = tmdbId;
    else delete next.tmdbId;
    return { movie: next, errors };
  }

  async function save() {
    if (state.saving || !state.mode) return;
    const result = readForm();
    if (result.errors.length) {
      showMessages(result.errors, []);
      setState('请修正表单', 'error');
      toast('表单还有错误，未保存', 'error');
      return;
    }
    const movies = state.movies.slice();
    if (state.mode === 'new') {
      movies.push(result.movie);
    } else {
      const index = movies.findIndex((movie) => movie.id === state.selectedId);
      if (index === -1) {
        showMessages(['找不到当前条目，请刷新页面。'], []);
        return;
      }
      movies[index] = result.movie;
    }

    setSaving(true);
    setState('保存并构建中…');
    try {
      const res = await api('/api/movies', { method: 'PUT', body: JSON.stringify({ movies }) });
      state.movies = movies;
      state.mode = 'edit';
      state.selectedId = result.movie.id;
      state.dirty = false;
      if (res.meta) state.meta = res.meta;
      fillForm(result.movie);
      renderList();
      reportBuild(res, '已保存并重建');
      if (state.meta.updated) {
        els.bottomHint.textContent = `上次更新 ${state.meta.updated} · 保存前自动备份 · 保存后自动构建`;
      }
      requestAnimationFrame(() => {
        const item = Array.from(els.movieList.children).find((node) => node.dataset.id === result.movie.id);
        if (item) item.scrollIntoView({ block: 'nearest' });
      });
    } catch (error) {
      setState('保存失败', 'error');
      showMessages([error.message, ...(error.errors || [])], error.warnings || []);
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteCurrent() {
    if (state.saving || state.mode !== 'edit') return;
    const movie = state.movies.find((item) => item.id === state.selectedId);
    if (!movie) return;
    if (!confirm(`确定删除「${movie.title || movie.id}」？\n保存后会立即重建站点。`)) return;

    const movies = state.movies.filter((item) => item.id !== movie.id);
    setSaving(true);
    setState('删除并构建中…');
    try {
      const res = await api('/api/movies', { method: 'PUT', body: JSON.stringify({ movies }) });
      state.movies = movies;
      state.dirty = false;
      if (res.meta) state.meta = res.meta;
      renderList();
      if (movies.length) selectMovie(movies[0].id, { force: true });
      else showEmpty();
      reportBuild(res, '已删除并重建');
      if (state.meta.updated) {
        els.bottomHint.textContent = `上次更新 ${state.meta.updated} · 保存前自动备份 · 保存后自动构建`;
      }
    } catch (error) {
      setState('删除失败', 'error');
      showMessages([error.message, ...(error.errors || [])], error.warnings || []);
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function rebuild() {
    if (state.saving || state.siteSaving || state.bulkBusy) return;
    setSaving(true);
    setState('构建中…');
    try {
      const res = await api('/api/build', { method: 'POST', body: '{}' });
      if (res.ok) {
        setState('构建完成', 'ok');
        if (state.view === 'site') renderMessages(els.siteMessages, [], []);
        else hideMessages();
        toast('站点已重建', 'ok');
      } else {
        setState('构建失败', 'error');
        showActiveMessages(buildErrorLines(res), []);
        toast('构建失败', 'error');
      }
    } catch (error) {
      setState('构建失败', 'error');
      showActiveMessages([error.message], []);
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function showActiveMessages(errors, warnings) {
    renderMessages(state.view === 'site' ? els.siteMessages : els.messages, errors, warnings);
  }

  /* ---------- site settings ---------- */
  const siteField = (name) => els.siteForm.elements.namedItem(name);
  const siteVal = (name) => {
    const el = siteField(name);
    return el ? String(el.value).trim() : '';
  };
  const setSiteVal = (name, value) => {
    const el = siteField(name);
    if (el) el.value = value === undefined || value === null ? '' : String(value);
  };

  function setSiteStatus(text) {
    els.siteStatus.textContent = text || '';
  }

  function markSiteDirty() {
    if (state.siteSaving) return;
    if (!state.siteDirty) {
      state.siteDirty = true;
      setSiteStatus('有未保存的修改');
      setState('未保存', 'warn');
    }
  }

  function onSiteChange() {
    if (state.view !== 'site' || !state.siteConfig) return;
    markSiteDirty();
  }

  async function ensureSiteLoaded() {
    if (state.siteConfig) return;
    setSiteStatus('正在读取站点设置…');
    renderMessages(els.siteMessages, [], []);
    try {
      const data = await api('/api/site');
      state.siteConfig = data.config || {};
      renderSiteForm(state.siteConfig);
      state.siteDirty = false;
      setSiteStatus('');
      updateSaveButtons();
    } catch (error) {
      setSiteStatus('加载失败');
      renderMessages(els.siteMessages, [error.message], []);
      toast(error.message, 'error');
    }
  }

  async function discardSiteChanges() {
    if (state.siteSaving) return;
    if (state.siteDirty && !confirm('站点设置尚未保存，确定放弃修改？')) return;
    setSiteStatus('正在重新读取…');
    try {
      const data = await api('/api/site');
      state.siteConfig = data.config || {};
      renderSiteForm(state.siteConfig);
      state.siteDirty = false;
      renderMessages(els.siteMessages, [], []);
      setSiteStatus('已放弃修改');
      setState('就绪');
      updateSaveButtons();
    } catch (error) {
      setSiteStatus('读取失败');
      renderMessages(els.siteMessages, [error.message], []);
    }
  }

  function renderSiteForm(config) {
    setSiteVal('name', config.name);
    setSiteVal('nameEn', config.nameEn);
    setSiteVal('tagline', config.tagline);
    setSiteVal('description', config.description);
    setSiteVal('url', config.url);
    setSiteVal('base', config.base);
    const footer = config.footer || {};
    setSiteVal('footerNote', footer.note);
    setSiteVal('footerCopyright', footer.copyright);
    setSiteVal('footerIcp', footer.icp);
    els.footerCols.replaceChildren();
    (Array.isArray(footer.columns) ? footer.columns : []).forEach((column) => addFooterColumn(column));
  }

  function addFooterColumn(column = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'footer-col-editor';

    const head = document.createElement('div');
    head.className = 'footer-col-head';
    const title = document.createElement('input');
    title.dataset.field = 'column-title';
    title.placeholder = '栏目名称，如：浏览';
    title.setAttribute('aria-label', '栏目名称');
    title.value = column.title || '';
    const removeCol = document.createElement('button');
    removeCol.type = 'button';
    removeCol.className = 'btn small ghost danger';
    removeCol.dataset.action = 'remove-col';
    removeCol.textContent = '删除栏目';
    head.append(title, removeCol);

    const links = document.createElement('div');
    links.className = 'footer-links';
    const initial = Array.isArray(column.links) ? column.links : [];
    initial.forEach((link) => addFooterLink(links, link));
    if (!initial.length) addFooterLink(links);

    const actions = document.createElement('div');
    actions.className = 'footer-col-actions';
    const addLink = document.createElement('button');
    addLink.type = 'button';
    addLink.className = 'btn small';
    addLink.dataset.action = 'add-link';
    addLink.textContent = '添加链接';
    actions.append(addLink);

    wrap.append(head, links, actions);
    els.footerCols.append(wrap);
  }

  function addFooterLink(container, link = {}) {
    const row = document.createElement('div');
    row.className = 'footer-link-row';
    const label = document.createElement('input');
    label.dataset.field = 'link-label';
    label.placeholder = '链接文字';
    label.setAttribute('aria-label', '链接文字');
    label.value = link.label || '';
    const href = document.createElement('input');
    href.dataset.field = 'link-href';
    href.placeholder = '/list/index.html';
    href.setAttribute('aria-label', '链接地址');
    href.value = link.href || '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small ghost danger';
    remove.dataset.action = 'remove-link';
    remove.textContent = '移除';
    row.append(label, href, remove);
    container.append(row);
  }

  function onFooterColsClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'add-link') {
      const links = button.closest('.footer-col-editor')?.querySelector('.footer-links');
      if (!links) return;
      addFooterLink(links);
      markSiteDirty();
      return;
    }
    if (action === 'remove-link') {
      button.closest('.footer-link-row')?.remove();
      markSiteDirty();
      return;
    }
    if (action === 'remove-col') {
      button.closest('.footer-col-editor')?.remove();
      markSiteDirty();
    }
  }

  function readSiteForm() {
    const errors = [];
    const config = clone(state.siteConfig || {});
    config.name = siteVal('name');
    config.nameEn = siteVal('nameEn');
    config.tagline = siteVal('tagline');
    config.description = siteVal('description');
    config.url = siteVal('url');
    config.base = siteVal('base');
    config.footer = { ...(config.footer || {}) };
    config.footer.note = siteVal('footerNote');
    config.footer.copyright = siteVal('footerCopyright');
    config.footer.icp = siteVal('footerIcp');
    config.footer.columns = [];

    if (!config.name) errors.push('站名不能为空');
    if (!/^https?:\/\//.test(config.url)) errors.push('站点 URL 必须是完整的 http(s) 地址');
    if (config.base && (!config.base.startsWith('/') || config.base.endsWith('/'))) {
      errors.push('子路径 base 应形如 "/films"，以 / 开头且不以 / 结尾');
    }
    if (!config.footer.copyright) errors.push('版权文案不能为空');

    $$('.footer-col-editor', els.footerCols).forEach((column, index) => {
      const title = column.querySelector('[data-field="column-title"]').value.trim();
      const links = [];
      $$('.footer-link-row', column).forEach((row, linkIndex) => {
        const label = row.querySelector('[data-field="link-label"]').value.trim();
        const href = row.querySelector('[data-field="link-href"]').value.trim();
        if (!label && !href) return;
        const at = `页脚第 ${index + 1} 栏第 ${linkIndex + 1} 个链接`;
        if (!label) errors.push(`${at}缺少文字`);
        if (!href) errors.push(`${at}缺少地址`);
        else if (!href.startsWith('/') || href.startsWith('//')) errors.push(`${at}的地址必须是以 / 开头的站内路径`);
        links.push({ label, href });
      });
      if (!title && !links.length) return;
      if (!title) errors.push(`页脚第 ${index + 1} 栏缺少名称`);
      config.footer.columns.push({ title, links });
    });

    return { config, errors };
  }

  async function saveSite() {
    if (state.siteSaving || state.view !== 'site' || !state.siteConfig) return;
    const { config, errors } = readSiteForm();
    if (errors.length) {
      renderMessages(els.siteMessages, errors, []);
      setSiteStatus('请修正设置');
      setState('请修正设置', 'error');
      return;
    }
    state.siteSaving = true;
    document.body.classList.add('site-saving');
    els.btnSaveSite.disabled = true;
    setSiteStatus('保存并构建中…');
    renderMessages(els.siteMessages, [], []);
    updateSaveButtons();
    try {
      const res = await api('/api/site', { method: 'PUT', body: JSON.stringify({ config }) });
      state.siteConfig = config;
      state.siteDirty = false;
      state.site = { ...state.site, title: config.name, url: config.url, base: config.base };
      if (res.build && res.build.ok) {
        setSiteStatus('已保存，站点已更新');
        setState('站点已更新', 'ok');
        toast('站点设置已保存，站点已更新', 'ok');
      } else {
        setSiteStatus('设置已保存，但构建失败');
        renderMessages(els.siteMessages, buildErrorLines(res.build), res.warnings || []);
        setState('设置已保存，构建失败', 'error');
        toast('设置已保存，但构建失败', 'error');
      }
    } catch (error) {
      setSiteStatus('保存失败');
      renderMessages(els.siteMessages, [error.message, ...(error.errors || [])], error.warnings || []);
      setState('保存失败', 'error');
      toast(error.message, 'error');
    } finally {
      state.siteSaving = false;
      document.body.classList.remove('site-saving');
      els.btnSaveSite.disabled = !state.siteConfig;
      updateSaveButtons();
    }
  }

  function reportBuild(res, successText) {
    const buildOk = Boolean(res.build && res.build.ok);
    const errors = buildOk ? [] : buildErrorLines(res.build);
    const warnings = Array.isArray(res.warnings) ? res.warnings : [];
    if (errors.length || warnings.length) showMessages(errors, warnings);
    else hideMessages();
    if (buildOk) {
      setState(successText, 'ok');
      toast(`${successText}，站点已更新`, 'ok');
    } else {
      setState('数据已保存，构建失败', 'error');
      toast('数据已保存，但构建失败', 'error');
    }
  }

  function buildErrorLines(build) {
    if (!build) return ['构建没有返回结果。'];
    const lines = [build.stderr, build.stdout]
      .filter(Boolean)
      .join('\n')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const errors = lines.filter((line) => /^x |错误|失败|Error|error/i.test(line));
    const picked = errors.length ? errors : lines;
    return picked.slice(-30).length ? picked.slice(-30) : ['构建失败，请检查终端输出。'];
  }

  function discardChanges() {
    if (!state.mode || state.saving) return;
    if (state.dirty && !confirm('确定放弃当前修改？')) return;
    if (state.mode === 'new') {
      state.dirty = false;
      if (state.movies.length) selectMovie(state.movies[0].id, { force: true });
      else showEmpty();
      return;
    }
    const movie = state.movies.find((item) => item.id === state.selectedId);
    if (!movie) return;
    fillForm(movie);
    state.dirty = false;
    renderList();
    hideMessages();
    setState('已放弃修改');
  }

  function showEmpty() {
    state.mode = null;
    state.selectedId = null;
    state.dirty = false;
    els.form.hidden = true;
    els.empty.hidden = false;
    renderList();
    updateSaveButtons();
  }

  function generateSlug() {
    if (!state.mode) return;
    const source = val('originalTitle') || val('title');
    const year = val('year');
    let slug = source
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) slug = 'entry';
    if (year) slug += `-${year}`;
    let candidate = slug;
    let index = 2;
    while (state.movies.some((movie) => movie.id === candidate && !(state.mode === 'edit' && movie.id === state.selectedId))) {
      candidate = `${slug}-${index++}`;
    }
    setVal('id', candidate);
    markDirty();
    updateHeader();
  }

  function setState(text, tone = '') {
    els.state.textContent = text;
    els.state.dataset.tone = tone;
  }

  function renderMessages(container, errors, warnings) {
    const items = [
      ...(errors || []).map((text) => ({ text, tone: 'error' })),
      ...(warnings || []).map((text) => ({ text, tone: 'warn' })),
    ];
    container.replaceChildren();
    if (!items.length) {
      container.hidden = true;
      return;
    }
    items.forEach(({ text, tone }) => {
      const line = document.createElement('div');
      line.className = `msg ${tone}`;
      line.textContent = text;
      container.append(line);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'msg-close';
    close.setAttribute('aria-label', '关闭提示');
    close.textContent = '×';
    close.addEventListener('click', () => {
      container.hidden = true;
      container.replaceChildren();
    });
    container.append(close);
    container.hidden = false;
  }

  function showMessages(errors, warnings) {
    renderMessages(els.messages, errors, warnings);
  }

  function hideMessages() {
    els.messages.hidden = true;
    els.messages.replaceChildren();
  }

  function toast(text, tone = '') {
    clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.dataset.tone = tone;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3600);
  }

  function setTmdbStatus(text, tone = '') {
    els.tmdbStatus.textContent = text;
    els.tmdbStatus.dataset.tone = tone;
    els.tmdbStatus.hidden = !text;
  }

  function clearTmdbResults() {
    els.tmdbResults.replaceChildren();
    setTmdbStatus('');
  }

  function rememberKey(key) {
    state.tmdbKey = key.trim();
    if (els.tmdbKey.value !== state.tmdbKey) els.tmdbKey.value = state.tmdbKey;
    if (els.bulkKey.value !== state.tmdbKey) els.bulkKey.value = state.tmdbKey;
    try {
      if (state.tmdbKey) localStorage.setItem(KEY_STORAGE, state.tmdbKey);
      else localStorage.removeItem(KEY_STORAGE);
    } catch { /* storage may be unavailable */ }
  }

  function forgetTmdbKey() {
    els.tmdbKey.value = '';
    rememberKey('');
    setTmdbStatus('已清除本机保存的 TMDB Key。');
  }

  async function searchTmdb() {
    if (state.saving) return;
    const key = els.tmdbKey.value.trim();
    if (!key) {
      setTmdbStatus('先填写 TMDB API Key。', 'error');
      els.tmdbKey.focus();
      return;
    }
    if (val('type') === 'concert') {
      setTmdbStatus('演唱会条目不支持 TMDB 检索。', 'error');
      return;
    }
    const query = els.tmdbQuery.value.trim() || val('originalTitle') || val('title');
    if (!query) {
      setTmdbStatus('先填写片名或搜索词。', 'error');
      return;
    }
    const yearRaw = val('year');
    const type = val('type') === 'series' ? 'tv' : 'movie';
    rememberKey(key);
    els.btnTmdbSearch.disabled = true;
    setTmdbStatus('正在搜索 TMDB…');
    try {
      const data = await api('/api/tmdb/search', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: key,
          query,
          type,
          year: yearRaw ? Number(yearRaw) : undefined,
        }),
      });
      const results = Array.isArray(data.results) ? data.results : [];
      renderTmdbResults(results, type);
      setTmdbStatus(results.length ? `找到 ${results.length} 个结果，选一条填入。` : '没有找到结果，换个搜索词试试。');
    } catch (error) {
      setTmdbStatus(error.message, 'error');
    } finally {
      els.btnTmdbSearch.disabled = false;
    }
  }

  function renderTmdbResults(results, type) {
    els.tmdbResults.replaceChildren();
    results.forEach((result) => {
      const card = document.createElement('article');
      card.className = 'tmdb-result';
      const poster = document.createElement('div');
      poster.className = 'poster';
      if (result.poster) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = result.poster;
        img.addEventListener('error', () => img.remove());
        poster.append(img);
      } else {
        poster.textContent = (result.title || '?').slice(0, 1);
      }
      const copy = document.createElement('div');
      copy.className = 'copy';
      const heading = document.createElement('h4');
      heading.textContent = result.title || '(无标题)';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = [
        result.year,
        result.originalTitle,
        result.rating ? `${result.rating} 分` : '',
        result.votes ? `${result.votes} 票` : '',
      ].filter(Boolean).join(' · ');
      const overview = document.createElement('p');
      overview.textContent = result.overview || 'TMDB 暂无中文简介。';
      const actions = document.createElement('div');
      actions.className = 'tmdb-actions';
      const fill = document.createElement('button');
      fill.type = 'button';
      fill.className = 'btn small';
      fill.textContent = '填入当前条目';
      fill.addEventListener('click', () => importTmdb(type, result.id, fill, false));
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'btn small ghost';
      create.textContent = '新建条目';
      create.addEventListener('click', () => importTmdb(type, result.id, create, true));
      actions.append(fill, create);
      copy.append(heading, meta, overview, actions);
      card.append(poster, copy);
      els.tmdbResults.append(card);
    });
  }

  async function importTmdb(type, id, button, createNew = false) {
    const key = els.tmdbKey.value.trim();
    if (!key) {
      setTmdbStatus('TMDB Key 已丢失，请重新填写。', 'error');
      return;
    }
    const card = button.closest('.tmdb-result');
    const buttons = card ? Array.from(card.querySelectorAll('button')) : [button];
    const label = button.textContent;
    button.textContent = '读取中…';
    buttons.forEach((item) => { item.disabled = true; });
    setTmdbStatus('正在读取 TMDB 详情…');
    try {
      const data = await api('/api/tmdb/details', {
        method: 'POST',
        body: JSON.stringify({ apiKey: key, type, id }),
      });
      const fields = data.fields || {};
      if (createNew) {
        if (state.dirty && !confirm('当前修改尚未保存，确定放弃并新建条目？')) {
          setTmdbStatus('已取消新建。');
          return;
        }
        if (!newMovie({ force: true })) return;
        setVal('type', type === 'tv' ? 'series' : 'movie');
        applyTmdbFields(fields);
        generateSlug();
        state.dirty = true;
        updateHeader();
        setTmdbStatus(`已用 TMDB #${id} 新建草稿，检查后保存。`, 'ok');
        toast('已用 TMDB 新建条目，检查后保存', 'ok');
      } else {
        applyTmdbFields(fields);
        setTmdbStatus(`已填入 TMDB #${id} 的元数据，检查后保存。`, 'ok');
        toast('已填入 TMDB 元数据', 'ok');
      }
    } catch (error) {
      setTmdbStatus(error.message, 'error');
    } finally {
      buttons.forEach((item) => { item.disabled = false; });
      button.textContent = label;
    }
  }

  function applyTmdbFields(fields) {
    const setIf = (name, value) => {
      if (value === undefined || value === null || String(value).trim() === '') return;
      setVal(name, value);
    };
    setIf('title', fields.title);
    setIf('originalTitle', fields.originalTitle);
    setIf('year', fields.year);
    if (fields.rating !== undefined && fields.rating !== null && Number(fields.rating) > 0) {
      setVal('rating', fields.rating);
    }
    if (fields.votes) setVal('votes', fields.votes);
    if (fields.runtime) setVal('runtime', fields.runtime);
    if (Array.isArray(fields.genres) && fields.genres.length) setVal('genres', fields.genres.join(', '));
    setIf('country', fields.country);
    setIf('language', fields.language);
    setIf('tagline', fields.tagline);
    setIf('overview', fields.overview);
    if (fields.poster) setVal('poster', fields.poster);
    if (fields.backdrop) setVal('backdrop', fields.backdrop);
    if (Array.isArray(fields.directors) && fields.directors.length) setVal('directors', fields.directors.join(', '));
    if (Array.isArray(fields.cast) && fields.cast.length) setVal('cast', fields.cast.join(', '));
    if (fields.tmdbId) setVal('tmdbId', fields.tmdbId);
    markDirty();
    updateHeader();
    updatePreviews();
  }

  /* ---------- bulk import ---------- */
  function renderBulkLists() {
    if (!els.bulkType || !els.bulkList) return;
    const type = els.bulkType.value === 'tv' ? 'tv' : 'movie';
    const previous = els.bulkList.value;
    const lists = BULK_LISTS[type];
    els.bulkList.replaceChildren();
    lists.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      els.bulkList.append(option);
    });
    const values = lists.map(([value]) => value);
    els.bulkList.value = values.includes(previous) ? previous : values[0];
    syncBulkPage();
  }

  function syncBulkPage() {
    if (!els.bulkPage) return;
    const key = `${els.bulkType.value}:${els.bulkList.value}`;
    const saved = Number(state.bulkPages[key]);
    els.bulkPage.value = String(Number.isInteger(saved) && saved >= 1 && saved <= 500 ? saved : 1);
  }

  function rememberBulkPage(key, page) {
    state.bulkPages[key] = page;
    try { localStorage.setItem(BULK_PAGE_KEY, JSON.stringify(state.bulkPages)); } catch { /* ignore */ }
  }

  function nextBulkPage(run) {
    if (run.exhausted || run.lastPage >= 500) return 1;
    return Math.max(1, run.lastPage + 1);
  }

  function applyBulkNextPage(run) {
    const next = nextBulkPage(run);
    const wrapped = run.exhausted || run.lastPage >= 500;
    rememberBulkPage(`${run.type}:${run.list}`, next);
    if (els.bulkType.value === run.type && els.bulkList.value === run.list) {
      els.bulkPage.value = String(next);
    }
    return { next, wrapped };
  }

  function setBulkStatus(text, tone = '') {
    els.bulkStatus.textContent = text;
    els.bulkStatus.dataset.tone = tone;
  }

  function renderBulkCounts() {
    const { imported, skipped, failed } = state.bulkStats;
    els.bulkCounts.textContent = `新增 ${imported} · 跳过 ${skipped} · 失败 ${failed}`;
  }

  function setBulkProgress(done, total) {
    const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    els.bulkBar.style.width = `${percent}%`;
    els.bulkProgress.setAttribute('aria-valuenow', String(percent));
  }

  function logBulk(text, tone = '') {
    if (!els.bulkLog) return;
    const line = document.createElement('li');
    if (tone) line.dataset.tone = tone;
    line.textContent = text;
    els.bulkLog.append(line);
    while (els.bulkLog.children.length > 80) els.bulkLog.firstElementChild.remove();
    els.bulkLog.scrollTop = els.bulkLog.scrollHeight;
  }

  function renderDraftCard() {
    if (!els.bulkDraftCard) return;
    const count = state.bulkDrafts.length;
    els.bulkDraftCard.hidden = count === 0;
    els.bulkDraftCount.textContent = `${count} 条`;
    updateBulkControls();
  }

  function updateBulkControls() {
    if (!els.bulkForm) return;
    const busy = state.bulkBusy || state.saving || state.siteSaving;
    const hasDrafts = state.bulkDrafts.length > 0;
    ['bulkKey', 'bulkType', 'bulkList', 'bulkPage', 'bulkCount'].forEach((name) => {
      if (els[name]) els[name].disabled = busy;
    });
    if (els.btnBulkForgetKey) els.btnBulkForgetKey.disabled = busy;
    if (els.btnBulkStart) {
      els.btnBulkStart.disabled = busy || hasDrafts;
      els.btnBulkStart.textContent = state.bulkBusy ? '导入中…' : (hasDrafts ? '先保存或放弃当前批次' : '开始导入');
    }
    if (els.btnBulkCancel) {
      els.btnBulkCancel.hidden = !state.bulkBusy || state.saving;
      els.btnBulkCancel.disabled = state.bulkCancel;
    }
    if (els.btnBulkSave) els.btnBulkSave.disabled = busy || !hasDrafts;
    if (els.btnBulkDiscard) els.btnBulkDiscard.disabled = busy || !hasDrafts;
  }

  function normalizeTitle(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{S}\s]+/gu, '');
  }

  function titleKey(value, year) {
    const normalized = normalizeTitle(value);
    if (!normalized || !Number.isInteger(year)) return '';
    return `${normalized}|${year}`;
  }

  function addToDedupeIndex(index, movie) {
    const type = movie.type === 'series' ? 'series' : 'movie';
    if (movie.tmdbId) index.tmdb.add(`${type}:${Number(movie.tmdbId)}`);
    const year = Number(movie.year);
    [movie.title, movie.originalTitle].forEach((value) => {
      const key = titleKey(value, year);
      if (key) index.titles.add(key);
    });
  }

  function buildDedupeIndex() {
    const index = { tmdb: new Set(), titles: new Set() };
    state.movies.forEach((movie) => addToDedupeIndex(index, movie));
    return index;
  }

  function bulkIdBase(movie) {
    return String(movie.originalTitle || movie.title || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
  }

  function uniqueBulkId(movie, usedIds) {
    let base = bulkIdBase(movie);
    if (!base) base = `tmdb-${movie.type === 'series' ? 'tv' : 'movie'}-${movie.tmdbId}`;
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
    usedIds.add(candidate);
    return candidate;
  }

  function makeBulkDraft(fields, item, type, usedIds) {
    const year = Number(fields.year) || Number(item.year);
    const maxYear = new Date().getFullYear() + 5;
    const title = String(fields.title || item.title || '').trim();
    if (!title || !Number.isInteger(year) || year < 1888 || year > maxYear) return null;

    const ratingRaw = Number(fields.rating);
    const rating = Number.isFinite(ratingRaw) && ratingRaw > 0 && ratingRaw <= 10
      ? Math.round(ratingRaw * 10) / 10
      : null;
    const runtimeRaw = Number(fields.runtime);
    const runtime = Number.isInteger(runtimeRaw) && runtimeRaw > 0 ? runtimeRaw : null;
    const votesRaw = Number(fields.votes);
    const votes = Number.isFinite(votesRaw) && votesRaw >= 0 ? Math.round(votesRaw) : null;
    const tmdbRaw = Number(fields.tmdbId);

    const movie = {
      title,
      originalTitle: String(fields.originalTitle || item.originalTitle || '').trim(),
      year,
      type: type === 'tv' ? 'series' : 'movie',
      genres: Array.isArray(fields.genres) ? fields.genres.map((genre) => String(genre).trim()).filter(Boolean) : [],
      runtime,
      rating,
      votes,
      country: String(fields.country || '').trim(),
      language: String(fields.language || '').trim(),
      directors: Array.isArray(fields.directors) ? fields.directors.filter(Boolean) : [],
      cast: Array.isArray(fields.cast) ? fields.cast.filter(Boolean) : [],
      tagline: String(fields.tagline || '').trim(),
      overview: String(fields.overview || '').trim(),
      quality: [],
      collections: [],
      added: today(),
      poster: String(fields.poster || item.poster || '').trim(),
      backdrop: String(fields.backdrop || '').trim(),
      sources: [],
      tmdbId: Number.isInteger(tmdbRaw) && tmdbRaw > 0 ? tmdbRaw : Number(item.id),
    };
    movie.id = uniqueBulkId(movie, usedIds);
    return movie;
  }

  async function importBulkItem(item, run, index, usedIds) {
    const stats = state.bulkStats;
    const id = Number(item.id);
    const title = String(item.title || '').trim();
    const year = Number(item.year);
    const maxYear = new Date().getFullYear() + 5;
    const label = `${title || '(无标题)'}${Number.isInteger(year) ? `（${year}）` : ''}`;

    if (!Number.isInteger(id) || id <= 0) {
      stats.failed += 1;
      logBulk('失败 · 条目缺少有效 TMDB ID', 'error');
      return;
    }
    const targetType = run.type === 'tv' ? 'series' : 'movie';
    if (index.tmdb.has(`${targetType}:${id}`)) {
      stats.skipped += 1;
      logBulk(`跳过 · TMDB 已收录：${label}`, 'warn');
      return;
    }
    if (!Number.isInteger(year) || year < 1888 || year > maxYear) {
      stats.failed += 1;
      logBulk(`失败 · 年份无效：${label}`, 'error');
      return;
    }
    const keys = [titleKey(item.title, year), titleKey(item.originalTitle, year)].filter(Boolean);
    if (keys.some((key) => index.titles.has(key))) {
      stats.skipped += 1;
      logBulk(`跳过 · 同名同年已存在：${label}`, 'warn');
      return;
    }

    setBulkStatus(`读取详情：${label}…`);
    let data;
    try {
      data = await api('/api/tmdb/details', {
        method: 'POST',
        body: JSON.stringify({ apiKey: run.apiKey, type: run.type, id }),
      });
    } catch (error) {
      if (error.status === 404) {
        stats.failed += 1;
        logBulk(`失败 · TMDB 没有详情：${label}`, 'error');
        return;
      }
      throw error;
    }
    if (state.bulkCancel) return;

    const draft = makeBulkDraft(data.fields || {}, item, run.type, usedIds);
    if (!draft) {
      stats.failed += 1;
      logBulk(`失败 · 详情字段不完整：${label}`, 'error');
      return;
    }
    state.bulkDrafts.push(draft);
    addToDedupeIndex(index, draft);
    stats.imported += 1;
    logBulk(`新增 · ${draft.title}（${draft.year}）`, 'ok');
  }

  async function fetchBulkPages(run, index, usedIds) {
    for (let offset = 0; offset < run.pages; offset += 1) {
      if (state.bulkCancel) return;
      const page = run.startPage + offset;
      if (page > 500) {
        run.exhausted = true;
        break;
      }
      setBulkStatus(`读取榜单：${bulkListLabel(run.type, run.list)} 第 ${page} 页…`);
      const data = await api('/api/tmdb/list', {
        method: 'POST',
        body: JSON.stringify({ apiKey: run.apiKey, type: run.type, list: run.list, page }),
      });
      if (state.bulkCancel) return;
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) {
        run.exhausted = true;
        logBulk(`第 ${page} 页没有结果，榜单已到末尾。`, 'warn');
        break;
      }
      for (const item of results) {
        if (state.bulkCancel) return;
        await importBulkItem(item, run, index, usedIds);
        run.processed = Math.min(run.total, run.processed + 1);
        renderBulkCounts();
        renderDraftCard();
        setBulkProgress(run.processed, run.total);
        if (!state.bulkCancel) {
          setBulkStatus(
            `已处理 ${run.processed} / ${run.total} · 新增 ${state.bulkStats.imported} · 跳过 ${state.bulkStats.skipped} · 失败 ${state.bulkStats.failed}`,
          );
        }
        await sleep(DETAIL_DELAY);
      }
      run.lastPage = page;
      const totalPages = Number(data.totalPages) || 0;
      if (totalPages && page >= totalPages) {
        run.exhausted = true;
        logBulk(`已到榜单最后一页（第 ${page} 页）。`, 'warn');
        break;
      }
    }
  }

  function finishBulkError(error) {
    const message = (error && error.message) || '导入中止';
    const pending = state.bulkDrafts.length;
    setBulkStatus(pending ? `导入中止：${message}。已获取 ${pending} 条，可手动保存。` : `导入中止：${message}`, 'error');
    renderMessages(els.bulkMessages, [message], []);
    logBulk(`中止 · ${message}`, 'error');
    setState('导入中止', 'error');
    toast(pending ? '导入中止，已获取的条目仍可保存' : '导入中止', 'error');
  }

  function finishBulkCancel() {
    const pending = state.bulkDrafts.length;
    const text = pending
      ? `已取消导入。已获取 ${pending} 条，仍在浏览器内存中，可保存或放弃。`
      : '已取消导入，没有获取到新条目。';
    setBulkStatus(text, pending ? 'warn' : '');
    logBulk(pending ? `已取消 · 待保存 ${pending} 条` : '已取消', pending ? 'warn' : '');
    setState(pending ? '已取消，待保存' : '已取消', pending ? 'warn' : '');
    toast(pending ? `已取消导入，${pending} 条待保存` : '已取消导入', pending ? 'warn' : '');
  }

  async function startBulkImport(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.bulkBusy || state.saving || state.siteSaving) return;
    if (state.bulkDrafts.length) {
      const message = '已有待保存的条目，请先保存或放弃，再开始新的批次。';
      renderMessages(els.bulkMessages, [message], []);
      setBulkStatus(message, 'warn');
      setState('有待保存条目', 'warn');
      return;
    }
    if (state.dirty) {
      const message = '影片库有未保存的修改，请先回到影片库保存或放弃后再开始导入。';
      renderMessages(els.bulkMessages, [message], []);
      setBulkStatus(message, 'warn');
      setState('影片库有未保存修改', 'warn');
      return;
    }

    const apiKey = els.bulkKey.value.trim();
    const type = els.bulkType.value === 'tv' ? 'tv' : 'movie';
    const list = els.bulkList.value;
    const startPage = Number(els.bulkPage.value);
    const count = Number(els.bulkCount.value);
    const errors = [];
    if (!apiKey) errors.push('请填写 TMDB API Key。');
    if (!BULK_LISTS[type].some(([value]) => value === list)) errors.push('榜单选择无效。');
    if (!Number.isInteger(startPage) || startPage < 1 || startPage > 500) errors.push('起始页应为 1–500 的整数。');
    if (![50, 100, 200, 500].includes(count)) errors.push('每批条数无效。');
    if (errors.length) {
      renderMessages(els.bulkMessages, errors, []);
      setBulkStatus(errors[0], 'error');
      setState('请修正导入设置', 'error');
      return;
    }
    const pages = Math.ceil(count / 20);
    if (startPage + pages - 1 > 500) {
      const message = `起始页过高：从第 ${startPage} 页开始，${pages} 页会超出 TMDB 的 500 页上限。`;
      renderMessages(els.bulkMessages, [message], []);
      setBulkStatus(message, 'error');
      setState('起始页超出范围', 'error');
      return;
    }

    rememberKey(apiKey);
    const run = {
      apiKey,
      type,
      list,
      startPage,
      pages,
      total: pages * 20,
      processed: 0,
      lastPage: startPage - 1,
      exhausted: false,
      completed: false,
    };
    state.bulkRun = run;
    state.bulkBusy = true;
    state.bulkCancel = false;
    state.bulkDrafts = [];
    state.bulkStats = { imported: 0, skipped: 0, failed: 0 };
    document.body.classList.add('bulk-busy');
    renderMessages(els.bulkMessages, [], []);
    els.bulkProgressCard.hidden = false;
    els.bulkLog.replaceChildren();
    renderBulkCounts();
    renderDraftCard();
    setBulkProgress(0, run.total);
    setBulkStatus(`准备导入：${TYPE_LABEL[type]} · ${bulkListLabel(type, list)} · 第 ${startPage}–${startPage + pages - 1} 页`);
    setState('批量导入中…');
    updateSaveButtons();

    const index = buildDedupeIndex();
    const usedIds = new Set(state.movies.map((movie) => movie.id));
    try {
      try {
        await fetchBulkPages(run, index, usedIds);
        if (!state.bulkCancel) run.completed = true;
      } catch (error) {
        finishBulkError(error);
      }

      if (state.bulkCancel) {
        finishBulkCancel();
      } else if (run.completed) {
        setBulkProgress(100, 100);
        if (state.bulkDrafts.length) {
          setBulkStatus(`获取完成，共 ${state.bulkStats.imported} 条，正在保存并重建…`);
          await saveBulkDrafts({ auto: true });
        } else {
          const { next, wrapped } = applyBulkNextPage(run);
          const nextText = wrapped ? '榜单已到末尾，下一批起始页回到 1。' : `下一批起始页：${next}。`;
          const summary = `导入完成：没有新增条目（跳过 ${state.bulkStats.skipped}，失败 ${state.bulkStats.failed}）。${nextText}`;
          setBulkStatus(summary, 'warn');
          logBulk(`本批没有新增条目。${nextText}`, 'warn');
          setState('没有新增条目', 'warn');
          toast('本批没有新增条目', 'warn');
        }
      }
    } finally {
      state.bulkBusy = false;
      state.bulkCancel = false;
      document.body.classList.remove('bulk-busy');
      renderDraftCard();
      updateSaveButtons();
    }
  }

  async function saveBulkDrafts() {
    if (state.saving || state.siteSaving || !state.bulkDrafts.length) return;
    if (state.dirty) {
      const message = '影片库有未保存的修改，请先回到影片库处理后再保存批量条目。';
      renderMessages(els.bulkMessages, [message], []);
      setBulkStatus(message, 'warn');
      setState('影片库有未保存修改', 'warn');
      return;
    }

    const drafts = state.bulkDrafts.slice();
    const movies = state.movies.concat(drafts);
    state.saving = true;
    renderMessages(els.bulkMessages, [], []);
    setBulkStatus('正在写入 data/movies.json 并重建站点…');
    setState('保存并构建中…');
    updateSaveButtons();

    try {
      const res = await api('/api/movies', { method: 'PUT', body: JSON.stringify({ movies }) });
      state.movies = movies;
      state.dirty = false;
      if (res.meta) state.meta = res.meta;
      renderList();
      state.bulkDrafts = [];
      renderDraftCard();

      const run = state.bulkRun;
      let pageNote = '';
      if (run && run.completed) {
        const { next, wrapped } = applyBulkNextPage(run);
        pageNote = wrapped ? '榜单已到末尾，下一批起始页回到 1。' : `下一批起始页：${next}。`;
      }

      const warnings = Array.isArray(res.warnings) ? res.warnings.slice(0, 30) : [];
      const buildOk = Boolean(res.build && res.build.ok);
      logBulk(`保存成功 · ${drafts.length} 条已写入`, 'ok');
      if (buildOk) {
        renderMessages(els.bulkMessages, [], warnings);
        setBulkStatus(`已保存 ${drafts.length} 条，站点已重建。${pageNote}`, 'ok');
        setState(`已导入 ${drafts.length} 条`, 'ok');
        toast(`已导入 ${drafts.length} 条，站点已更新`, 'ok');
      } else {
        renderMessages(els.bulkMessages, buildErrorLines(res.build), warnings);
        setBulkStatus(`已保存 ${drafts.length} 条，但构建失败。${pageNote}`, 'error');
        setState('已保存，构建失败', 'error');
        toast('数据已保存，但构建失败', 'error');
      }
      if (state.meta.updated) {
        els.bottomHint.textContent = `上次更新 ${state.meta.updated} · 保存前自动备份 · 保存后自动构建`;
      }
    } catch (error) {
      renderMessages(
        els.bulkMessages,
        [error.message, ...(error.errors || [])],
        (error.warnings || []).slice(0, 30),
      );
      setBulkStatus(`保存失败：${error.message}。条目仍在浏览器内存中，可稍后重试。`, 'error');
      setState('保存失败', 'error');
      toast('保存失败，条目仍保留', 'error');
    } finally {
      state.saving = false;
      renderDraftCard();
      updateSaveButtons();
    }
  }

  function cancelBulkImport() {
    if (!state.bulkBusy || state.bulkCancel) return;
    state.bulkCancel = true;
    updateBulkControls();
    setBulkStatus('正在取消，等待当前请求结束…', 'warn');
  }

  function discardBulkDrafts() {
    if (state.bulkBusy || state.saving || !state.bulkDrafts.length) return;
    if (!confirm(`确定放弃这 ${state.bulkDrafts.length} 条尚未保存的条目？`)) return;
    state.bulkDrafts = [];
    state.bulkRun = null;
    renderDraftCard();
    renderMessages(els.bulkMessages, [], []);
    setBulkStatus('已放弃待保存条目。');
    setState('就绪');
    toast('已放弃待保存条目', 'ok');
  }

  function forgetBulkKey() {
    if (state.bulkBusy || state.saving) return;
    els.bulkKey.value = '';
    rememberKey('');
    setState('就绪');
    toast('已清除本机保存的 TMDB Key', 'ok');
  }
})();
