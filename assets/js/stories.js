/* Stories: live publishing, 24h expiry, seen-state, fullscreen viewer. */
(function () {
  'use strict';

  var DURATION = 5000;
  var WINDOW = 24 * 60 * 60 * 1000;
  var SEEN_KEY = 'fmert-stories-seen';
  var BADGES = { image: 'FOTO', text: 'METİN', link: 'YAZI' };

  var section = document.getElementById('stories');
  var viewer = document.getElementById('story-viewer');
  if (!section || !viewer) return;

  function renderLiveCards(stories) {
    var row = section.querySelector('.stories-row');
    row.innerHTML = '';
    stories.forEach(function (story) {
      var card = document.createElement('button');
      card.className = 'story-card';
      card.hidden = true;
      card.dataset.id = story.id;
      card.dataset.type = story.type;
      card.dataset.posted = story.posted;
      card.dataset.text = story.text;
      if (story.subtext) card.dataset.subtext = story.subtext;
      if (story.image) card.dataset.image = story.image;
      if (story.bg) card.dataset.bg = story.bg;
      if (story.link) {
        card.dataset.link = story.link;
        card.dataset.linkLabel = story.link_label || 'Aç';
      }

      var ring = document.createElement('span');
      ring.className = 'story-ring';
      var preview = document.createElement('span');
      preview.className = 'story-preview';
      if (story.image) preview.style.backgroundImage = 'url("' + story.image + '")';
      else if (story.bg) preview.style.background = story.bg;
      ['story-scrim', 'story-badge', 'story-title'].forEach(function (name) {
        var el = document.createElement('span');
        el.className = name;
        if (name === 'story-title') el.textContent = story.title || story.text;
        preview.appendChild(el);
      });
      ring.appendChild(preview);
      var dim = document.createElement('span');
      dim.className = 'story-dim';
      ring.appendChild(dim);
      card.appendChild(ring);
      var time = document.createElement('span');
      time.className = 'story-time';
      card.appendChild(time);
      row.appendChild(card);
    });
  }

  function start() {

  var seen = {};
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  } catch (e) { /* corrupted storage: treat all as unseen */ }

  /* ---- 24h rule ---- */
  var now = Date.now();
  var cards = Array.prototype.slice.call(section.querySelectorAll('.story-card'));
  var fresh = cards.filter(function (c) {
    return now - Date.parse(c.dataset.posted) < WINDOW;
  });

  var visible;
  if (fresh.length > 0) {
    visible = fresh;
  } else {
    var newest = cards.reduce(function (a, b) {
      return Date.parse(b.dataset.posted) > Date.parse(a.dataset.posted) ? b : a;
    }, cards[0]);
    if (!newest) return;
    newest.classList.add('expired');
    visible = [newest];
  }

  function timeLabel(card) {
    if (card.classList.contains('expired')) return 'Son hikaye';
    var hours = Math.floor((now - Date.parse(card.dataset.posted)) / 3600000);
    return hours < 1 ? 'Az önce' : hours + ' sa önce';
  }

  function paintRings() {
    visible.forEach(function (c) {
      c.classList.toggle(
        'seen',
        !c.classList.contains('expired') && !!seen[c.dataset.id]
      );
    });
  }

  visible.forEach(function (c, i) {
    var expired = c.classList.contains('expired');
    c.querySelector('.story-badge').textContent =
      expired ? 'ARŞİV' : BADGES[c.dataset.type] || 'METİN';
    c.querySelector('.story-time').textContent = timeLabel(c);
    c.hidden = false;
    c.addEventListener('click', function () { open(i); });
  });
  paintRings();

  section.querySelector('.stories-count').textContent =
    fresh.length + ' yeni · 24 saat görünür';
  section.hidden = false;

  /* ---- viewer ---- */
  var idx = 0;
  var progress = 0;
  var timer = null;
  var paused = false;

  function $(sel) { return viewer.querySelector(sel); }
  var barsEl = $('.sv-progress');
  var canvas = $('.sv-canvas');

  function markSeen(i) {
    seen[visible[i].dataset.id] = true;
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch (e) { /* private mode: seen-state just won't persist */ }
  }

  function setPaused(p) {
    paused = p;
    $('.sv-pause i').className = p ? 'fas fa-play' : 'fas fa-pause';
  }

  function render() {
    var card = visible[idx];
    var d = card.dataset;
    canvas.dataset.type = d.type;
    if (window.FmertLikes) {
      window.FmertLikes.mount($('.sv-likes'), 'story', d.id, function () { setPaused(true); });
    }

    var img = $('.sv-img');
    var scrim = $('.sv-img-scrim');
    if (d.image) {
      img.style.backgroundImage = 'url("' + d.image + '")';
      img.hidden = false;
      scrim.hidden = false;
      /* restart the Ken Burns zoom */
      img.style.animation = 'none';
      void img.offsetWidth;
      img.style.animation = '';
      canvas.style.background = '#101019';
    } else {
      img.hidden = true;
      scrim.hidden = true;
      canvas.style.background = d.bg || 'var(--card-bg)';
    }

    $('.sv-text').textContent = d.text;
    var sub = $('.sv-subtext');
    sub.hidden = !d.subtext;
    sub.textContent = d.subtext || '';

    var cta = $('.sv-cta');
    cta.hidden = !d.link;
    if (d.link) {
      $('.sv-cta-link').href = d.link;
      $('.sv-cta-link span').textContent = d.linkLabel;
    }

    $('.sv-time').textContent = timeLabel(card);
    $('.sv-expired-badge').hidden = !card.classList.contains('expired');
    $('.sv-prev').style.visibility = idx === 0 ? 'hidden' : '';

    Array.prototype.forEach.call(barsEl.children, function (bar, i) {
      bar.firstElementChild.style.transform = 'scaleX(' + (i < idx ? 1 : 0) + ')';
    });
  }

  function startTimer() {
    clearInterval(timer);
    progress = 0;
    var fill = barsEl.children[idx].firstElementChild;
    timer = setInterval(function () {
      if (paused) return;
      progress += 100 / (DURATION / 100);
      fill.style.transform = 'scaleX(' + Math.min(progress / 100, 1) + ')';
      if (progress >= 100) next();
    }, 100);
  }

  function open(i) {
    idx = i;
    markSeen(i);
    barsEl.innerHTML = visible
      .map(function () { return '<div class="sv-bar"><div></div></div>'; })
      .join('');
    setPaused(false);
    viewer.hidden = false;
    document.body.style.overflow = 'hidden';
    render();
    startTimer();
  }

  function close() {
    clearInterval(timer);
    timer = null;
    viewer.hidden = true;
    document.body.style.overflow = '';
    paintRings();
  }

  function next() {
    if (idx >= visible.length - 1) { close(); return; }
    idx += 1;
    markSeen(idx);
    render();
    startTimer();
  }

  function prev() {
    if (idx > 0) idx -= 1;
    render();
    startTimer();
  }

  function stop(fn) {
    return function (e) { e.stopPropagation(); fn(); };
  }

  viewer.addEventListener('click', function (e) {
    if (e.target === viewer) close();
  });
  $('.sv-close').addEventListener('click', stop(close));
  $('.sv-pause').addEventListener('click', stop(function () { setPaused(!paused); }));
  $('.sv-next').addEventListener('click', stop(next));
  $('.sv-prev').addEventListener('click', stop(prev));
  $('.sv-tap-right').addEventListener('click', stop(next));
  $('.sv-tap-left').addEventListener('click', stop(prev));
  $('.sv-cta-link').addEventListener('click', function (e) { e.stopPropagation(); });

  document.addEventListener('keydown', function (e) {
    if (viewer.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  });

  }

  fetch('/stories-api?fresh=' + Date.now(), { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('Hikâye servisine ulaşılamadı');
      return response.json();
    })
    .then(renderLiveCards)
    .then(start)
    .catch(start); // Keep the built-in stories as an offline fallback.
})();
