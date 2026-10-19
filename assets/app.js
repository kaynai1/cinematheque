/* 光影档案 — 前台交互
   1) 明暗主题切换（记住选择）  2) 导航展开
   3) 筛选 / 搜索 / 排序         4) 我的片单（localStorage）
   5) 滚动进场动画              6) URL 参数预置筛选
*/
(function () {
  'use strict';
  var D = window.__ARCHIVE__ || { items: [], base: '' };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k, f) { try { var v = localStorage.getItem(k); return v === null ? f : JSON.parse(v); } catch (e) { return f; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- theme ---------- */
  var THEME_KEY = 'archive.theme';
  var root = document.documentElement;
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    var m = $('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#f4f2ed' : '#0b0b0d');
  }
  applyTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  var tt = $('#themeToggle');
  if (tt) tt.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next); store.set(THEME_KEY, next);
  });

  /* ---------- nav ---------- */
  var mt = $('#menuToggle'), nav = $('.nav');
  if (mt && nav) mt.addEventListener('click', function () {
    var open = nav.classList.toggle('is-open');
    mt.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  var head = $('.site-head');
  if (head) {
    var onScroll = function () { head.classList.toggle('is-stuck', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- favourites ---------- */
  var FAV_KEY = 'archive.favs';
  var favs = store.get(FAV_KEY, []);
  if (!Array.isArray(favs)) favs = [];
  var byId = {};
  (D.items || []).forEach(function (i) { byId[i.id] = i; });

  function persist() { store.set(FAV_KEY, favs); }
  function isFav(id) { return favs.indexOf(id) > -1; }

  function syncCounts() {
    $$('[data-fav-count]').forEach(function (el) {
      el.textContent = String(favs.length);
      el.hidden = favs.length === 0;
    });
    $$('[data-fav-total]').forEach(function (el) { el.textContent = String(favs.length); });
  }

  function syncButtons() {
    $$('[data-fav]').forEach(function (b) {
      var on = isFav(b.getAttribute('data-fav'));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (b.classList.contains('btn')) b.textContent = on ? '已加入片单' : '加入我的片单';
    });
  }

  function toggleFav(id, el) {
    var i = favs.indexOf(id);
    if (i > -1) favs.splice(i, 1); else favs.unshift(id);
    persist(); syncCounts(); syncButtons();
    if (el) {
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
    renderMyList();
    document.dispatchEvent(new CustomEvent('archive:favchange', { detail: { id: id } }));
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-fav]') : null;
    if (!b) return;
    e.preventDefault();
    toggleFav(b.getAttribute('data-fav'), b);
  });

  var clearBtn = $('[data-fav-clear]');
  if (clearBtn) clearBtn.addEventListener('click', function () {
    if (!favs.length) return;
    favs = []; persist(); syncCounts(); syncButtons(); renderMyList();
  });

  /* ---------- render "my list" ---------- */
  function renderMyList() {
    var g = $('[data-fav-grid]');
    if (!g) return;
    var ids = favs.slice();
    var html = ids.map(function (id) {
      var it = byId[id];
      if (!it) return '';
      return cardHTML(it);
    }).join('');
    g.innerHTML = html;
    var empty = $('[data-empty]');
    if (empty) empty.hidden = ids.length > 0;
    syncButtons();
  }

  function posterHTML(it) {
    var q = (it.q && it.q[0]) || '';
    var h = hash(it.id), ph = h % 360, ph2 = (h % 360 + 35 + ((h >> 9) % 90)) % 360;
    var img = it.p ? '<img class="poster-img" src="' + esc(it.p) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<div class="poster" style="--ph:' + ph + ';--ph2:' + ph2 + '">' + img +
      '<span class="poster-art" aria-hidden="true"><span class="poster-art-title">' + esc(it.t) + '</span></span>' +
      (q ? '<span class="qbadge q-' + esc(q.replace(/[^\w]/g, '')) + '">' + esc(q) + '</span>' : '') +
      '</div>';
  }

  function cardHTML(it) {
    return '<article class="card" data-id="' + esc(it.id) + '">' +
      '<a class="card-link" href="' + (D.base || '') + '/' + it.u + '">' + posterHTML(it) +
      '<div class="card-body"><h3 class="card-title">' + esc(it.t) + '</h3>' +
      '<p class="card-meta"><span>' + it.y + '</span> · ' + esc((it.g || []).slice(0, 2).join(' / ')) + '</p>' +
      '<div class="card-foot"><span class="score"><span class="score-num">' + (it.r ? it.r.toFixed(1) : '—') + '</span><span class="score-max">/10</span></span>' +
      '<span class="card-type">' + ({ movie: '电影', series: '剧集', concert: '演唱会' }[it.ty] || it.ty) + '</span></div></div></a>' +
      '<button class="fav-btn" type="button" data-fav="' + esc(it.id) + '" aria-pressed="true" title="移出片单"><span class="fav-ico" aria-hidden="true"></span></button>' +
      '</article>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------- filters ---------- */
  var wrap = $('[data-filters]');
  if (wrap) {
    var scope = wrap.parentElement;
    var grid = $('[data-grid]', scope);
    var cards = grid ? $$('.card', grid) : [];
    var searchEl = $('[data-search]', wrap);
    var countEl = $('[data-count]', wrap);
    var sortEl = $('[data-sort]', wrap);
    var sels = $$('[data-filter]', wrap);
    var emptyEl = $('[data-empty]', scope);

    var defaultSort = (sortEl && sortEl.value) || '';
    var state = { q: '', type: '', genre: '', quality: '', sort: defaultSort };

    function seedFromURL() {
      var p = new URLSearchParams(location.search);
      state.q = searchEl ? p.get('q') || '' : '';
      if (searchEl) searchEl.value = state.q;
      ['type', 'genre', 'quality'].forEach(function (k) {
        var sel = sels.filter(function (s) { return s.getAttribute('data-filter') === k; })[0];
        if (!sel) { state[k] = ''; return; }
        sel.value = p.get(k) || '';
        state[k] = sel.value;
      });
      if (sortEl) {
        sortEl.value = p.get('sort') || defaultSort;
        if (!sortEl.value) sortEl.value = defaultSort;
        state.sort = sortEl.value || defaultSort;
      }
    }

    function writeURL(push) {
      var p = new URLSearchParams(location.search);
      var q = { q: state.q, type: state.type, genre: state.genre, quality: state.quality, sort: state.sort === defaultSort ? '' : state.sort };
      Object.keys(q).forEach(function (k) { if (q[k]) p.set(k, q[k]); else p.delete(k); });
      var qs = p.toString();
      var url = location.pathname + (qs ? '?' + qs : '') + location.hash;
      if (url === location.pathname + location.search + location.hash) return;
      history[push ? 'pushState' : 'replaceState'](null, '', url);
    }

    function txt(c) {
      return ((c.getAttribute('data-title') || '') + ' ' + (c.getAttribute('data-original') || '') + ' ' +
        (c.getAttribute('data-cast') || '') + ' ' + (c.getAttribute('data-directors') || '') + ' ' +
        (c.getAttribute('data-genres') || '')).toLowerCase();
    }

    var index = new Map();
    cards.forEach(function (c) { index.set(c, txt(c)); });

    function apply(opts) {
      opts = opts || {};
      var q = state.q.trim().toLowerCase();
      var shown = [];
      cards.forEach(function (c) {
        var ok = true;
        if (q && index.get(c).indexOf(q) === -1) ok = false;
        if (ok && state.type && c.getAttribute('data-type') !== state.type) ok = false;
        if (ok && state.genre && (c.getAttribute('data-genres') || '').split('|').indexOf(state.genre) === -1) ok = false;
        if (ok && state.quality && (c.getAttribute('data-quality') || '').split('|').indexOf(state.quality) === -1) ok = false;
        c.hidden = !ok;
        if (ok) shown.push(c);
      });
      if (grid) {
        var cmp = {
          added: function (a, b) { return String(b.getAttribute('data-added')).localeCompare(String(a.getAttribute('data-added'))); },
          rating: function (a, b) { return (parseFloat(b.getAttribute('data-rating')) || 0) - (parseFloat(a.getAttribute('data-rating')) || 0); },
          year: function (a, b) { return (parseInt(b.getAttribute('data-year'), 10) || 0) - (parseInt(a.getAttribute('data-year'), 10) || 0); },
          'year-asc': function (a, b) { return (parseInt(a.getAttribute('data-year'), 10) || 0) - (parseInt(b.getAttribute('data-year'), 10) || 0); },
          title: function (a, b) { return String(a.getAttribute('data-title')).localeCompare(String(b.getAttribute('data-title')), 'zh'); }
        }[state.sort];
        if (cmp) {
          shown.sort(cmp);
          shown.forEach(function (c) { grid.appendChild(c); });
        }
      }
      if (countEl) countEl.textContent = String(shown.length);
      if (emptyEl) emptyEl.hidden = shown.length > 0;
      if (!opts.silent) writeURL(opts.push);
    }

    if (searchEl) {
      var t;
      searchEl.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { state.q = searchEl.value; apply(); }, 130);
      });
      searchEl.addEventListener('search', function () { state.q = searchEl.value; apply(); });
    }
    sels.forEach(function (s) {
      s.addEventListener('change', function () {
        state[s.getAttribute('data-filter')] = s.value;
        apply({ push: true });
      });
    });
    if (sortEl) sortEl.addEventListener('change', function () { state.sort = sortEl.value; apply({ push: true }); });
    window.addEventListener('popstate', function () { seedFromURL(); apply({ silent: true }); });
    seedFromURL();
    apply({ silent: true });
  }

  /* ---------- reveal on scroll ---------- */
  var reveals = $$('.reveal');
  if (reveals.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
      reveals.forEach(function (el) { io.observe(el); });
    } else {
      reveals.forEach(function (el) { el.classList.add('is-in'); });
    }
  }

  /* ---------- init ---------- */
  syncCounts();
  syncButtons();
  renderMyList();
  window.__archiveReady = true;
})();
