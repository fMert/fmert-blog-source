(function () {
  'use strict';

  var mutations = Promise.resolve();
  var t = window.FmertI18n || {};
  var HEART_SVG = '<svg class="fmert-like-heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>';

  function mount(host, kind, id, onInteract) {
    if (!host || !id) return;
    host.replaceChildren();
    var isStory = kind === 'story';

    var row = document.createElement('div');
    row.className = 'fmert-like-row';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'fmert-like-button';
    button.setAttribute('aria-pressed', 'false');
    button.disabled = true;
    button.setAttribute('aria-label', t.like || 'Like');
    button.innerHTML = HEART_SVG;

    var labelSpan = null;
    if (!isStory) {
      labelSpan = document.createElement('span');
      labelSpan.className = 'fmert-like-label';
      labelSpan.textContent = t.like || 'Like';
      button.appendChild(labelSpan);
    }

    var countSpan = document.createElement('span');
    countSpan.className = 'fmert-like-count';
    countSpan.setAttribute('aria-hidden', 'true');
    countSpan.textContent = '—';
    button.appendChild(countSpan);

    var message = document.createElement('span');
    message.className = 'fmert-like-message';
    message.setAttribute('role', 'status');

    row.append(button, message);
    host.appendChild(row);

    if (!isStory && t.like_notice) {
      var info = document.createElement('p');
      info.className = 'fmert-like-notice';
      info.textContent = t.like_notice;
      host.appendChild(info);
    }

    var liked = false;
    var count = 0;

    function showMessage(text, isError) {
      message.textContent = text || '';
      message.classList.toggle('is-error', !!isError);
    }

    function paint(state) {
      liked = !!state.liked;
      count = Number(state.count) || 0;
      button.setAttribute('aria-pressed', String(liked));
      countSpan.textContent = String(count);
      if (labelSpan) labelSpan.textContent = liked ? (t.liked || 'Liked') : (t.like || 'Like');
      var action = liked ? (t.unlike || 'Unlike') : (t.like || 'Like');
      var countText = (t.like_count || '{count} likes').replace('{count}', count);
      button.setAttribute('aria-label', action + ', ' + countText);
    }

    function readJson(response) {
      if (!response.ok) throw new Error('request failed');
      return response.json();
    }

    fetch('/stories-api/likes?' + new URLSearchParams({ kind: kind, id: id }), {
      cache: 'no-store',
      credentials: 'same-origin'
    })
      .then(readJson)
      .then(paint)
      .catch(function () { showMessage(t.like_load_failed || 'Could not load likes.', true); })
      .finally(function () { button.disabled = false; });

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (onInteract) onInteract();
      button.disabled = true;
      showMessage('');
      mutations = mutations.catch(function () {}).then(function () {
        return fetch('/stories-api/likes', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: kind,
            id: id,
            liked: !liked,
            page: location.pathname,
            referrer: document.referrer
          })
        })
          .then(readJson)
          .then(function (state) {
            paint(state);
            showMessage(state.liked ? (t.like_saved || 'Like saved.') : (t.like_removed || 'Like removed.'));
          })
          .catch(function () {
            showMessage(t.like_save_failed || 'Could not save. Try again.', true);
          })
          .finally(function () {
            button.disabled = false;
          });
      });
    });
  }

  window.FmertLikes = { mount: mount };

  var postSlot = document.getElementById('post-likes-mount');
  if (postSlot && postSlot.dataset.postId) {
    mount(postSlot, 'post', postSlot.dataset.postId);
  }
})();
