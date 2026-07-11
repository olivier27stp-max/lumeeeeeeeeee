/**
 * Lume CRM — request-form embed loader.
 *
 * Usage (copied from Settings > Request Form):
 *   <script src="https://<your-lume-app>/form.js" data-api-key="<key>"></script>
 *
 * Replaces itself with an iframe pointing at the hosted public form
 * (/form/<key>), auto-sizing to the form's height via postMessage when
 * available, with a sensible min-height fallback.
 */
(function () {
  var script = document.currentScript;
  if (!script) {
    // Fallback for browsers without currentScript: last matching script tag.
    var candidates = document.querySelectorAll('script[data-api-key][src*="form.js"]');
    script = candidates[candidates.length - 1];
  }
  if (!script) return;

  var apiKey = script.getAttribute('data-api-key');
  if (!apiKey || !/^[a-f0-9]{32,}$/i.test(apiKey)) {
    console.error('[Lume form] Missing or invalid data-api-key on the embed script tag.');
    return;
  }

  // The form is served from the same origin as this loader script.
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (e) {
    console.error('[Lume form] Could not resolve the script origin.');
    return;
  }

  var iframe = document.createElement('iframe');
  iframe.src = origin + '/form/' + apiKey;
  iframe.title = 'Service Request Form';
  iframe.style.width = '100%';
  iframe.style.minHeight = '800px';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  iframe.setAttribute('loading', 'lazy');

  // Auto-resize if the form page posts its height.
  window.addEventListener('message', function (ev) {
    if (ev.origin !== origin) return;
    var d = ev.data;
    if (d && d.type === 'lume-form-height' && typeof d.height === 'number' && d.height > 0) {
      iframe.style.height = Math.ceil(d.height) + 'px';
      iframe.style.minHeight = '0';
    }
  });

  script.parentNode.insertBefore(iframe, script);
})();
