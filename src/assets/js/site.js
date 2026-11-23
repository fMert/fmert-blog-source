(function () {
  'use strict';

  var t = window.FmertI18n || {};

  /* ---- Theme Toggle ---- */
  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-mode');
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var effective = current || (prefersDark ? 'dark' : 'light');
      var next = effective === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-mode', next);
      try {
        localStorage.setItem('fmert-theme', next);
      } catch (e) {}
    });
  }

  /* ---- Mobile Nav ---- */
  var mobileBtn = document.getElementById('mobile-menu-toggle');
  var mobileNav = document.getElementById('mobile-nav');
  if (mobileBtn && mobileNav) {
    mobileBtn.addEventListener('click', function () {
      var open = !mobileNav.hidden;
      mobileNav.hidden = open;
      mobileBtn.setAttribute('aria-expanded', String(!open));
    });
  }

  /* ---- Code Copy Buttons ---- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.code-copy');
    if (!btn) return;
    var block = btn.closest('.code-block');
    var code = block && block.querySelector('pre code');
    if (!code) return;
    var text = code.textContent || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = btn.dataset.copiedLabel || 'Copied';
        btn.classList.add('is-copied');
        setTimeout(function () {
          btn.textContent = btn.dataset.copyLabel || 'Copy';
          btn.classList.remove('is-copied');
        }, 1600);
      }).catch(function () {});
    }
  });

  /* ---- Archive Topic Filters ---- */
  var filterChips = Array.prototype.slice.call(document.querySelectorAll('.archive-filters .filter-chip'));
  if (filterChips.length) {
    var groups = Array.prototype.slice.call(document.querySelectorAll('[data-archive-group]'));
    filterChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var selected = chip.dataset.filter;
        filterChips.forEach(function (c) { c.classList.toggle('is-active', c === chip); });
        groups.forEach(function (group) {
          var visibleCount = 0;
          var items = group.querySelectorAll('.archive-item');
          items.forEach(function (item) {
            var cats = (item.dataset.categories || '').split(',').filter(Boolean);
            var show = selected === 'all' || cats.indexOf(selected) !== -1;
            item.hidden = !show;
            if (show) visibleCount++;
          });
          group.hidden = visibleCount === 0;
        });
      });
    });
  }

  /* ---- TOC Scrollspy ---- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc-list a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var headings = tocLinks
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var id = entry.target.id;
          tocLinks.forEach(function (a) {
            a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
          });
        });
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );
    headings.forEach(function (h) { observer.observe(h); });
  }

  /* ---- Instant Search Modal (⌘K / Ctrl+K / /) ---- */
  var modal = document.getElementById('search-modal');
  var openBtn = document.getElementById('search-open');
  var input = document.getElementById('search-input');
  var resultsEl = document.getElementById('search-results');
  var searchMeta = document.querySelector('meta[name="fmert-search-url"]');
  if (modal && input && resultsEl) {
    var indexPromise = null;
    var selectedIdx = -1;
    var previousFocus = null;

    function loadIndex() {
      if (!indexPromise) {
        var url = (searchMeta && searchMeta.content) || '/search.json';
        indexPromise = fetch(url)
          .then(function (r) { return r.ok ? r.json() : []; })
          .catch(function () { return []; });
      }
      return indexPromise;
    }

    function openSearch() {
      previousFocus = document.activeElement;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      loadIndex().then(function () { renderResults(input.value); });
      setTimeout(function () { input.focus(); input.select(); }, 10);
    }

    function closeSearch() {
      if (modal.hidden) return;
      modal.hidden = true;
      document.body.style.overflow = '';
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }

    function renderResults(query) {
      var q = String(query || '').trim().toLowerCase();
      selectedIdx = -1;
      if (!q) {
        resultsEl.innerHTML = '';
        var p = document.createElement('p');
        p.className = 'search-status';
        p.textContent = t.search_empty || 'Type to search posts.';
        resultsEl.appendChild(p);
        return;
      }

      loadIndex().then(function (items) {
        var terms = q.split(/\s+/).filter(Boolean);
        var matches = items.filter(function (item) {
          var haystack = [
            item.title,
            item.excerpt,
            (item.categories || []).join(' '),
            (item.tags || []).join(' ')
          ].join(' ').toLowerCase();
          return terms.every(function (term) { return haystack.indexOf(term) !== -1; });
        });

        resultsEl.innerHTML = '';
        if (!matches.length) {
          var empty = document.createElement('p');
          empty.className = 'search-status';
          empty.textContent = t.search_no_results || 'No matching posts.';
          resultsEl.appendChild(empty);
          return;
        }

        matches.slice(0, 10).forEach(function (item, idx) {
          var a = document.createElement('a');
          a.className = 'search-result-item' + (idx === 0 ? ' is-selected' : '');
          a.href = item.url;
          a.setAttribute('role', 'option');
          var title = document.createElement('span');
          title.className = 'search-result-title';
          title.textContent = item.title;
          var excerpt = document.createElement('span');
          excerpt.className = 'search-result-excerpt';
          excerpt.textContent = item.date + ' — ' + item.excerpt;
          a.append(title, excerpt);
          resultsEl.appendChild(a);
        });
        selectedIdx = 0;
      });
    }

    if (openBtn) openBtn.addEventListener('click', openSearch);
    modal.querySelectorAll('[data-search-close]').forEach(function (el) {
      el.addEventListener('click', closeSearch);
    });
    input.addEventListener('input', function () { renderResults(input.value); });

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (modal.hidden) openSearch();
        else closeSearch();
        return;
      }

      if (modal.hidden) {
        var tag = (e.target && e.target.tagName) || '';
        if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target.isContentEditable) {
          e.preventDefault();
          openSearch();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
        return;
      }

      var links = Array.prototype.slice.call(resultsEl.querySelectorAll('.search-result-item'));
      if (!links.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = (selectedIdx + 1) % links.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = (selectedIdx - 1 + links.length) % links.length;
      } else if (e.key === 'Enter' && selectedIdx >= 0 && links[selectedIdx]) {
        e.preventDefault();
        location.href = links[selectedIdx].href;
        return;
      } else {
        return;
      }
      links.forEach(function (l, i) { l.classList.toggle('is-selected', i === selectedIdx); });
      links[selectedIdx].scrollIntoView({ block: 'nearest' });
    });
  }
})();
