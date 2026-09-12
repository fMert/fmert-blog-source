(function () {
  'use strict';
  if (location.pathname.startsWith('/stories-') || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  var body = JSON.stringify({path: location.pathname, referrer: document.referrer});
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/stories-api/analytics/visit', new Blob([body], {type: 'application/json'}));
  } else {
    fetch('/stories-api/analytics/visit', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: body, keepalive: true, credentials: 'omit'}).catch(function () {});
  }
}());
