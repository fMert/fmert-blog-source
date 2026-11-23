(function () {
  'use strict';
  if (
    location.pathname.startsWith('/stories-') ||
    navigator.doNotTrack === '1' ||
    navigator.globalPrivacyControl === true
  ) {
    return;
  }

  var payload = JSON.stringify({
    path: location.pathname,
    referrer: document.referrer
  });

  var sent = false;
  if (navigator.sendBeacon) {
    try {
      sent = navigator.sendBeacon(
        '/stories-api/analytics/visit',
        new Blob([payload], { type: 'application/json' })
      );
    } catch (e) {
      sent = false;
    }
  }

  if (!sent) {
    fetch('/stories-api/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'omit'
    }).catch(function () {});
  }
})();
