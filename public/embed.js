/*! Focal embed — https://focal.wiki
 *
 * Drops a "Read in Focal" button onto any page. One tag, no dependencies:
 *
 *   <script src="https://focal.wiki/embed.js" data-focal-selector="article"></script>
 *
 * The text is extracted in the visitor's browser and handed to the reader through
 * the URL fragment (never transmitted to a server) or, for long texts, a direct
 * window-to-window postMessage. The reader opens in a minimal-chrome overlay on
 * the page itself (no new tab). Nothing is uploaded, no cookies are set, no
 * network request is made until the visitor clicks. A page that embeds this does
 * not send us its readers' data, because there is no path by which it could.
 *
 * Options, as data-focal-* attributes on the script tag:
 *   selector   CSS selector for the text container      (default: auto-detect)
 *   mount      CSS selector to inject the button into   (default: the container)
 *   position   before | after                           (default: before)
 *   label      button text                              (default: "Read in Focal")
 *   theme      auto | light | dark                      (default: auto)
 *   wpm        starting words per minute
 *   auto       "false" to skip auto-injection and drive window.Focal yourself
 *
 * Public API: window.Focal.open([el]) · .close() · .extract(el) · .inject(opts)
 */
(function () {
  'use strict';
  if (window.Focal) return;                       // idempotent: two copies, one button

  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    return all[all.length - 1];
  })();
  var cfg = (script && script.dataset) || {};
  var ORIGIN = (function () {
    try { return new URL(script.src, location.href).origin; }
    catch (e) { return 'https://focal.wiki'; }
  })();

  // ---- extraction --------------------------------------------------------
  var DROP = 'script,style,noscript,template,svg,canvas,iframe,form,button,select,' +
             'textarea,nav,aside,header,footer,figure figcaption,[aria-hidden="true"],' +
             '[hidden],.focal-btn,.focal-overlay';
  var BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dd,dt';

  function autoTarget() {
    var picks = ['article', '[role="main"]', 'main', '.post-content', '.entry-content',
                 '.article-body', '#content', 'body'];
    for (var i = 0; i < picks.length; i++) {
      var el = document.querySelector(picks[i]);
      if (el && el.textContent.replace(/\s+/g, ' ').trim().length > 400) return el;
    }
    return document.body;
  }

  function extract(el) {
    el = el || (cfg.focalSelector ? document.querySelector(cfg.focalSelector) : null) || autoTarget();
    if (!el) return { title: '', text: '' };
    var clone = el.cloneNode(true);
    var junk = clone.querySelectorAll(DROP);
    for (var i = 0; i < junk.length; i++) junk[i].remove();

    var nodes = clone.querySelectorAll(BLOCKS), parts = [];
    for (var j = 0; j < nodes.length; j++) {
      // Skip a block whose text is already covered by an ancestor block we took.
      if (nodes[j].querySelector(BLOCKS)) continue;
      var t = (nodes[j].innerText || nodes[j].textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 1) parts.push(t);
    }
    var text = parts.join('\n\n');
    if (text.length < 200) {                      // template with no semantic blocks
      text = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    }
    var title = (document.querySelector('meta[property="og:title"]') || {}).content ||
                (document.querySelector('h1') || {}).textContent ||
                document.title || '';
    return { title: String(title).replace(/\s+/g, ' ').trim().slice(0, 200), text: text };
  }

  // ---- handoff -----------------------------------------------------------
  function b64url(bytes) {
    var bin = '', CH = 0x8000;                    // chunked: apply() blows up on big arrays
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function deflate(str) {
    var bytes = new TextEncoder().encode(str);
    if (typeof CompressionStream !== 'function') return Promise.resolve(null);
    try {
      var s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Response(s).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    } catch (e) { return Promise.resolve(null); }
  }

  // Fragments are generous but not unlimited, and a multi-megabyte URL is a bad
  // idea regardless. Above this we hand the text over by postMessage instead.
  var FRAGMENT_LIMIT = 180000;

  function params(title) {
    var p = '';
    if (title) p += '&ti=' + encodeURIComponent(title);
    if (cfg.focalWpm) p += '&wpm=' + encodeURIComponent(cfg.focalWpm);
    if (cfg.focalTheme && cfg.focalTheme !== 'auto') p += '&theme=' + encodeURIComponent(cfg.focalTheme);
    return p;
  }

  // ---- overlay -----------------------------------------------------------
  // The reader opens embedded on the page itself: a backdrop + centered panel
  // holding an iframe of the reader in its minimal-chrome mode (&embed=1) —
  // word display, progress, wpm slider, play; tap the word to play/pause.
  var _overlay = null;

  function closeOverlay() {
    if (!_overlay) return;
    document.removeEventListener('keydown', _overlay.onKey, true);
    _overlay.root.remove();
    _overlay = null;
  }

  function openOverlay(src, title) {
    closeOverlay();
    styles();
    var root = document.createElement('div');
    root.className = 'focal-overlay';
    var backdrop = document.createElement('div');
    backdrop.className = 'focal-overlay-backdrop';
    backdrop.addEventListener('click', closeOverlay);
    var panel = document.createElement('div');
    panel.className = 'focal-overlay-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Focal — ' + (title || 'reader'));
    var bar = document.createElement('div');
    bar.className = 'focal-overlay-bar';
    var t = document.createElement('span');
    t.className = 'focal-overlay-title';
    t.appendChild(document.createTextNode(title || ''));   // textNode, never innerHTML
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'focal-overlay-close';
    x.setAttribute('aria-label', 'Close Focal');
    x.appendChild(document.createTextNode('×'));
    x.addEventListener('click', closeOverlay);
    bar.appendChild(t);
    bar.appendChild(x);
    var frame = document.createElement('iframe');
    frame.className = 'focal-overlay-frame';
    frame.title = 'Focal — ' + (title || 'reader');
    frame.src = src;
    panel.appendChild(bar);
    panel.appendChild(frame);
    root.appendChild(backdrop);
    root.appendChild(panel);
    var onKey = function (ev) {
      if (ev.key === 'Escape') { ev.stopPropagation(); closeOverlay(); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);
    _overlay = { root: root, onKey: onKey };
    return frame;
  }

  // Escape pressed while focus is inside the reader iframe: the reader
  // forwards it as a close ping (host keydown never fires cross-frame).
  window.addEventListener('message', function (ev) {
    if (ev.origin === ORIGIN && ev.data && ev.data.focal === 'close') closeOverlay();
  });

  function open(el) {
    var got = extract(el);
    if (!got.text || got.text.trim().length < 10) {
      return Promise.reject(new Error('no readable text on this page'));
    }
    return deflate(got.text).then(function (packed) {
      var frag = packed ? b64url(packed) : null;
      if (frag && frag.length <= FRAGMENT_LIMIT) {
        openOverlay(ORIGIN + '/#t=' + frag + params(got.title) + '&embed=1', got.title);
        return;
      }
      // Long text: embed the reader, wait for its ready ping, then post it across.
      var frame = openOverlay(ORIGIN + '/#post=1' + params(got.title) + '&embed=1', got.title);
      var sent = false;
      function onMsg(ev) {
        if (ev.origin !== ORIGIN || !ev.data || ev.data.focal !== 'ready' || sent) return;
        sent = true;
        frame.contentWindow.postMessage({ focal: 'text', text: got.text, title: got.title }, ORIGIN);
        window.removeEventListener('message', onMsg);
      }
      window.addEventListener('message', onMsg);
      setTimeout(function () { window.removeEventListener('message', onMsg); }, 20000);
    });
  }

  // ---- button ------------------------------------------------------------
  var CSS = '.focal-btn{display:inline-flex;align-items:center;gap:.5em;font:inherit;' +
    'font-size:.9em;line-height:1;padding:.6em 1em;border-radius:999px;cursor:pointer;' +
    'border:1px solid currentColor;background:transparent;color:inherit;opacity:.85;' +
    'text-decoration:none;transition:opacity .15s,transform .15s}' +
    '.focal-btn:hover{opacity:1;transform:translateY(-1px)}' +
    '.focal-btn[disabled]{opacity:.4;cursor:default;transform:none}' +
    '.focal-btn .focal-dot{width:.5em;height:.5em;border-radius:50%;background:currentColor;' +
    'flex:none}' +
    '@media (prefers-reduced-motion:reduce){.focal-btn{transition:none}' +
    '.focal-btn:hover{transform:none}}' +
    '.focal-overlay{position:fixed;inset:0;z-index:2147483000}' +
    '.focal-overlay-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.7);' +
    'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
    '.focal-overlay-panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'display:flex;flex-direction:column;width:min(1100px,94vw);height:min(760px,88vh);' +
    'overflow:hidden;border-radius:12px;border:1px solid rgba(255,255,255,.12);' +
    'background:#111317;box-shadow:0 40px 120px rgba(0,0,0,.8)}' +
    '.focal-overlay-bar{display:flex;align-items:center;justify-content:space-between;' +
    'height:44px;flex:none;padding:0 16px;border-bottom:1px solid rgba(255,255,255,.1)}' +
    '.focal-overlay-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    'font:9.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
    'text-transform:uppercase;letter-spacing:.2em;color:#78716c}' +
    '.focal-overlay-close{display:flex;align-items:center;justify-content:center;' +
    'width:32px;height:32px;border:0;border-radius:8px;background:transparent;' +
    'color:#78716c;font-size:16px;line-height:1;cursor:pointer;font-family:inherit}' +
    '.focal-overlay-close:hover{background:rgba(255,255,255,.05);color:#e7e5e4}' +
    '.focal-overlay-frame{width:100%;flex:1;border:0;background:#111317}';

  function styles() {
    if (document.getElementById('focal-embed-css')) return;
    var s = document.createElement('style');
    s.id = 'focal-embed-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function button(label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'focal-btn';
    var dot = document.createElement('span');
    dot.className = 'focal-dot';
    b.appendChild(dot);
    b.appendChild(document.createTextNode(label));   // textNode, never innerHTML
    b.addEventListener('click', function () {
      b.disabled = true;
      open().catch(function () {
        b.lastChild.nodeValue = 'Nothing to read here';
      }).then(function () {
        setTimeout(function () { b.disabled = false; b.lastChild.nodeValue = label; }, 2500);
      });
    });
    return b;
  }

  function inject(opts) {
    opts = opts || {};
    var container = (cfg.focalSelector ? document.querySelector(cfg.focalSelector) : null) || autoTarget();
    var mount = (opts.mount || cfg.focalMount) ? document.querySelector(opts.mount || cfg.focalMount) : container;
    if (!mount) return null;
    styles();
    var b = button(opts.label || cfg.focalLabel || 'Read in Focal');
    var pos = opts.position || cfg.focalPosition || 'before';
    if (mount === container && pos === 'before') mount.insertBefore(b, mount.firstChild);
    else if (pos === 'before') mount.insertBefore(b, mount.firstChild);
    else mount.appendChild(b);
    return b;
  }

  window.Focal = { open: open, close: closeOverlay, extract: extract, inject: inject, origin: ORIGIN, version: '1.1.0' };

  if (cfg.focalAuto !== 'false') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { inject(); });
    else inject();
  }
})();
