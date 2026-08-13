/*! Focal embed — https://focal.wiki
 *
 * Drops a "Read in Focal" button onto any page. One tag, no dependencies:
 *
 *   <script src="https://focal.wiki/embed.js" data-focal-selector="article"></script>
 *
 * The text is extracted in the visitor's browser and handed to the reader through
 * the URL fragment (never transmitted to a server) or, for long texts, a direct
 * window-to-window postMessage. Nothing is uploaded, no cookies are set, no
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
 * Public API: window.Focal.open([el]) · .extract(el) · .inject(opts)
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
             '[hidden],.focal-btn';
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

  function open(el) {
    var got = extract(el);
    if (!got.text || got.text.trim().length < 10) {
      return Promise.reject(new Error('no readable text on this page'));
    }
    return deflate(got.text).then(function (packed) {
      var frag = packed ? b64url(packed) : null;
      if (frag && frag.length <= FRAGMENT_LIMIT) {
        window.open(ORIGIN + '/#t=' + frag + params(got.title), '_blank', 'noopener');
        return;
      }
      // Long text: open the reader, wait for its ready ping, then post it across.
      var win = window.open(ORIGIN + '/#post=1' + params(got.title), '_blank');
      if (!win) throw new Error('pop-up blocked');
      var sent = false;
      function onMsg(ev) {
        if (ev.origin !== ORIGIN || !ev.data || ev.data.focal !== 'ready' || sent) return;
        sent = true;
        win.postMessage({ focal: 'text', text: got.text, title: got.title }, ORIGIN);
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
    '.focal-btn:hover{transform:none}}';

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
      open().catch(function (e) {
        b.lastChild.nodeValue = e.message === 'pop-up blocked' ? 'Allow pop-ups to read' : 'Nothing to read here';
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

  window.Focal = { open: open, extract: extract, inject: inject, origin: ORIGIN, version: '1.0.0' };

  if (cfg.focalAuto !== 'false') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { inject(); });
    else inject();
  }
})();
