(function () {
  'use strict';

  // Serialize changes so that the first like's browser cookie is established
  // before a second item is liked. The server makes repeated requests idempotent.
  var mutations = Promise.resolve();
  var notice = 'Beğeniyle birlikte IP, zaman, sayfa, cihaz/tarayıcı ve yönlendiren site bilgileri site sahibine görünür.';

  function mount(host, kind, id, onInteract) {
    host.replaceChildren();
    var isStory = kind === 'story';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'fmert-like-button';
    button.setAttribute('aria-pressed', 'false');
    button.disabled = true;
    button.setAttribute('aria-label', 'Beğen');
    var countLabel;
    if (isStory) {
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>';
      countLabel = document.createElement('span');
      countLabel.className = 'fmert-like-count';
      countLabel.setAttribute('aria-hidden', 'true');
      countLabel.textContent = '—';
      button.append(countLabel);
    } else {
      button.textContent = '♡ Beğen';
      button.title = notice;
    }
    var message = document.createElement('span');
    message.className = 'fmert-like-message';
    message.setAttribute('role', 'status');
    host.append(button, message);
    var liked = false;
    var count = 0;

    function showMessage(text, isError) {
      message.textContent = text;
      message.classList.toggle('is-error', !!isError);
    }

    function paint(state) {
      liked = state.liked;
      count = state.count;
      button.setAttribute('aria-pressed', String(liked));
      if (isStory) countLabel.textContent = count;
      else button.textContent = (liked ? '♥ Beğendin' : '♡ Beğen') + ' · ' + count;
      button.setAttribute('aria-label', (liked ? 'Beğeniyi geri al' : 'Beğen') + ', ' + count + ' beğeni');
    }

    function read(response) {
      if (!response.ok) throw new Error('request failed');
      return response.json();
    }

    fetch('/stories-api/likes?' + new URLSearchParams({kind: kind, id: id}), {cache: 'no-store', credentials: 'same-origin'})
      .then(read).then(paint)
      .catch(function () { showMessage('Beğeni sayısı yüklenemedi.', true); })
      .finally(function () { button.disabled = false; });

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (onInteract) onInteract();
      button.disabled = true;
      showMessage('');
      mutations = mutations.catch(function () {}).then(function () {
        return fetch('/stories-api/likes', {
          method: 'POST', credentials: 'same-origin',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({kind: kind, id: id, liked: !liked, referrer: document.referrer})
        }).then(read).then(function (state) {
          paint(state);
          showMessage(state.liked ? 'Beğenin kaydedildi.' : 'Beğenin geri alındı.');
        }).catch(function () {
          showMessage('Kaydedilemedi. Tekrar dene.', true);
        }).finally(function () { button.disabled = false; });
      });
    });
  }

  window.FmertLikes = {mount: mount};
  var post = document.querySelector('meta[name="fmert-post-id"]');
  var tail = document.querySelector('article .post-tail-wrapper');
  if (post && tail) {
    var section = document.createElement('section');
    section.className = 'fmert-post-likes';
    section.setAttribute('aria-label', 'Yazıyı beğen');
    var host = document.createElement('div');
    var info = document.createElement('small');
    info.className = 'fmert-like-notice';
    info.textContent = notice;
    section.append(host, info);
    tail.before(section);
    mount(host, 'post', post.content);
  }
}());
