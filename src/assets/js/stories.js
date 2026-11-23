/* Stories: live fetch with offline fallback, 24h expiry, seen rings, 60fps viewer. */
(function () {
  'use strict';

  var DURATION = 5000;
  var WINDOW_MS = 24 * 60 * 60 * 1000;
  var SEEN_KEY = 'fmert-stories-seen';
  var t = window.FmertI18n || {};
  var BADGES = {
    image: t.story_photo || 'Photo',
    text: t.story_text || 'Note',
    link: t.story_link || 'Article'
  };

  var section = document.getElementById('stories');
  var viewer = document.getElementById('story-viewer');
  if (!section || !viewer) return;

  function renderLiveCards(stories) {
    var row = section.querySelector('.stories-row');
    row.replaceChildren();
    stories.forEach(function (story) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'story-card';
      card.hidden = true;
      card.dataset.id = story.id || '';
      card.dataset.type = story.type || 'text';
      card.dataset.posted = story.posted || '';
      card.dataset.text = story.text || '';
      if (story.subtext) card.dataset.subtext = story.subtext;
      if (story.type === 'image' && story.image) card.dataset.image = story.image;
      if (story.bg) card.dataset.bg = story.bg;
      if (story.type === 'link' && story.link) {
        card.dataset.link = story.link;
        card.dataset.linkLabel = story.link_label || t.story_open || 'Open';
      }

      var ring = document.createElement('span');
      ring.className = 'story-ring';
      var preview = document.createElement('span');
      preview.className = 'story-preview';
      if (story.type === 'image' && story.image) {
        preview.style.backgroundImage = 'url("' + story.image.replace(/"/g, '%22') + '")';
      } else if (story.bg) {
        preview.style.background = story.bg;
      }

      var scrim = document.createElement('span');
      scrim.className = 'story-scrim';
      var badge = document.createElement('span');
      badge.className = 'story-badge';
      var title = document.createElement('span');
      title.className = 'story-title';
      title.textContent = story.title || story.text || '';

      preview.append(scrim, badge, title);
      ring.appendChild(preview);

      var time = document.createElement('span');
      time.className = 'story-time';

      card.append(ring, time);
      row.appendChild(card);
    });
  }

  function start() {
    var seen = {};
    try {
      seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
    } catch (e) {}

    var now = Date.now();
    var cards = Array.prototype.slice.call(section.querySelectorAll('.story-card'));
    if (!cards.length) {
      section.hidden = true;
      return;
    }

    var fresh = cards.filter(function (c) {
      var ts = Date.parse(c.dataset.posted);
      return !isNaN(ts) && now - ts < WINDOW_MS;
    });

    var visible;
    if (fresh.length > 0) {
      visible = fresh;
    } else {
      var newest = cards.reduce(function (a, b) {
        return (Date.parse(b.dataset.posted) || 0) > (Date.parse(a.dataset.posted) || 0) ? b : a;
      }, cards[0]);
      if (!newest) return;
      newest.classList.add('expired');
      visible = [newest];
    }

    function timeLabel(card) {
      if (card.classList.contains('expired')) return t.last_story || 'Latest story';
      var diffMs = Math.max(0, Date.now() - (Date.parse(card.dataset.posted) || Date.now()));
      var mins = Math.floor(diffMs / 60000);
      if (mins < 1) return t.just_now || 'Just now';
      if (mins < 60) return (t.minutes_ago || '{count}m ago').replace('{count}', mins);
      var hours = Math.floor(mins / 60);
      return (t.hours_ago || '{count}h ago').replace('{count}', hours);
    }

    function paintRings() {
      visible.forEach(function (c) {
        c.classList.toggle('seen', !c.classList.contains('expired') && !!seen[c.dataset.id]);
      });
    }

    visible.forEach(function (c, i) {
      var expired = c.classList.contains('expired');
      c.querySelector('.story-badge').textContent = expired
        ? (t.story_archive || 'Archive')
        : (BADGES[c.dataset.type] || BADGES.text);
      c.querySelector('.story-time').textContent = timeLabel(c);
      c.hidden = false;
      c.addEventListener('click', function () { open(i); });
    });
    paintRings();

    section.querySelector('.stories-count').textContent = fresh.length > 0
      ? (t.story_count_live || '{count} live').replace('{count}', fresh.length)
      : (t.story_count_archive || 'Latest story');
    section.hidden = false;

    /* ---- Fullscreen Viewer ---- */
    var idx = 0;
    var elapsed = 0;
    var lastFrame = 0;
    var rafId = null;
    var paused = false;
    var previousFocus = null;
    var touchStartX = 0;
    var touchStartY = 0;
    var holdTimer = null;
    var heldPaused = false;

    function $(sel) { return viewer.querySelector(sel); }
    var barsEl = $('.sv-progress');
    var canvas = $('.sv-canvas');
    var pauseBtn = $('.sv-pause');

    var PAUSE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    var PLAY_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>';

    function markSeen(i) {
      seen[visible[i].dataset.id] = true;
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
    }

    function setPaused(p) {
      paused = p;
      pauseBtn.innerHTML = p ? PLAY_SVG : PAUSE_SVG;
      pauseBtn.setAttribute('aria-label', p ? (t.story_resume || 'Resume') : (t.story_pause || 'Pause'));
      if (!p) lastFrame = performance.now();
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
      if (d.type === 'image' && d.image) {
        img.style.backgroundImage = 'url("' + d.image.replace(/"/g, '%22') + '")';
        img.hidden = false;
        scrim.hidden = false;
        canvas.style.background = '#141923';
      } else {
        img.hidden = true;
        scrim.hidden = true;
        canvas.style.background = d.bg || 'linear-gradient(155deg, #161d2e 0%, #0f172a 100%)';
      }

      $('.sv-text').textContent = d.text || '';
      var sub = $('.sv-subtext');
      sub.hidden = !d.subtext;
      sub.textContent = d.subtext || '';

      var cta = $('.sv-cta');
      var showLink = d.type === 'link' && !!d.link;
      cta.hidden = !showLink;
      if (showLink) {
        $('.sv-cta-link').href = d.link;
        $('.sv-cta-link span').textContent = d.linkLabel || t.story_open || 'Open';
      }

      $('.sv-time').textContent = timeLabel(card);
      $('.sv-expired-badge').hidden = !card.classList.contains('expired');
      $('.sv-prev').style.visibility = idx === 0 ? 'hidden' : '';

      Array.prototype.forEach.call(barsEl.children, function (bar, i) {
        bar.firstElementChild.style.transform = 'scaleX(' + (i < idx ? 1 : 0) + ')';
      });
    }

    function tick(nowTs) {
      if (viewer.hidden) return;
      if (!paused) {
        var dt = Math.min(100, nowTs - lastFrame);
        elapsed += dt;
        var pct = Math.min(elapsed / DURATION, 1);
        var fill = barsEl.children[idx] && barsEl.children[idx].firstElementChild;
        if (fill) fill.style.transform = 'scaleX(' + pct + ')';
        if (elapsed >= DURATION) {
          next();
          return;
        }
      }
      lastFrame = nowTs;
      rafId = requestAnimationFrame(tick);
    }

    function startProgress() {
      cancelAnimationFrame(rafId);
      elapsed = 0;
      lastFrame = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    function open(i) {
      previousFocus = document.activeElement;
      idx = i;
      markSeen(i);
      barsEl.innerHTML = visible.map(function () { return '<div class="sv-bar"><div></div></div>'; }).join('');
      setPaused(false);
      viewer.hidden = false;
      document.body.style.overflow = 'hidden';
      render();
      startProgress();
      $('.sv-close').focus();
    }

    function close() {
      cancelAnimationFrame(rafId);
      rafId = null;
      viewer.hidden = true;
      document.body.style.overflow = '';
      paintRings();
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }

    function next() {
      if (idx >= visible.length - 1) { close(); return; }
      idx += 1;
      markSeen(idx);
      render();
      startProgress();
    }

    function prev() {
      if (idx > 0) idx -= 1;
      render();
      startProgress();
    }

    function stop(fn) {
      return function (e) { e.stopPropagation(); fn(); };
    }

    viewer.addEventListener('click', function (e) { if (e.target === viewer) close(); });
    $('.sv-close').addEventListener('click', stop(close));
    pauseBtn.addEventListener('click', stop(function () { setPaused(!paused); }));
    $('.sv-next').addEventListener('click', stop(next));
    $('.sv-prev').addEventListener('click', stop(prev));
    $('.sv-tap-right').addEventListener('click', stop(next));
    $('.sv-tap-left').addEventListener('click', stop(prev));
    $('.sv-cta-link').addEventListener('click', function (e) { e.stopPropagation(); });

    /* Touch swipe & hold-to-pause */
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      heldPaused = false;
      holdTimer = setTimeout(function () {
        if (!paused) {
          heldPaused = true;
          setPaused(true);
        }
      }, 220);
    }, { passive: true });

    canvas.addEventListener('touchend', function (e) {
      clearTimeout(holdTimer);
      if (heldPaused) {
        heldPaused = false;
        setPaused(false);
        return;
      }
      if (!e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - touchStartX;
      var dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dy) > 70 && dy > 0 && Math.abs(dy) > Math.abs(dx)) {
        close();
      } else if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) next();
        else prev();
      }
    }, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (viewer.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
    });
  }

  var language = document.documentElement.dataset.lang || 'eo';
  fetch('/stories-api?lang=' + encodeURIComponent(language) + '&fresh=' + Date.now(), { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('stories api unavailable');
      return response.json();
    })
    .then(function (stories) {
      if (Array.isArray(stories) && stories.length) renderLiveCards(stories);
      start();
    })
    .catch(function () {
      // Offline / static-only mode: keep fallback YAML stories
      start();
    });
})();
