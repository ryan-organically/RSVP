(function(){
  const TAKES = [
    { n: '01', name: 'Linear' },
    { n: '02', name: 'Vercel Geist' },
    { n: '03', name: 'Notion' },
    { n: '04', name: 'Stripe Dash' },
    { n: '05', name: 'Vision Glass' },
    { n: '06', name: 'Raycast' },
    { n: '07', name: 'Arc Browser' },
    { n: '08', name: 'Readwise' },
    { n: '09', name: 'Superhuman' },
    { n: '10', name: 'Material You' }
  ];

  const path = location.pathname.split('/').pop() || '';
  const m = path.match(/take-(\d{2})\.html/);
  const currentIdx = m ? TAKES.findIndex(t => t.n === m[1]) : 0;
  const cur = TAKES[currentIdx] || TAKES[0];
  const prev = TAKES[(currentIdx - 1 + TAKES.length) % TAKES.length];
  const next = TAKES[(currentIdx + 1) % TAKES.length];

  const css = `
    .design-switcher{position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;align-items:center;gap:0;background:rgba(20,20,20,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.12);border-radius:999px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,0.32);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;user-select:none}
    .design-switcher button{background:transparent;border:none;color:#fff;cursor:pointer;font-size:14px;width:30px;height:30px;border-radius:999px;display:flex;align-items:center;justify-content:center;transition:background 0.15s;padding:0}
    .design-switcher button:hover{background:rgba(255,255,255,0.12)}
    .design-switcher .ds-label{padding:0 10px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;opacity:0.9;display:flex;align-items:center;gap:6px;min-width:120px;justify-content:center}
    .design-switcher .ds-num{opacity:0.55;font-variant-numeric:tabular-nums}
    .design-switcher .ds-menu{position:absolute;bottom:48px;right:0;background:rgba(20,20,20,0.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:6px;min-width:200px;box-shadow:0 16px 40px rgba(0,0,0,0.45);display:none;flex-direction:column;gap:2px}
    .design-switcher.open .ds-menu{display:flex}
    .design-switcher .ds-menu a{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;font-size:13px;color:#fff;text-decoration:none;border-radius:8px;transition:background 0.12s}
    .design-switcher .ds-menu a:hover{background:rgba(255,255,255,0.08)}
    .design-switcher .ds-menu a.cur{background:rgba(255,255,255,0.12)}
    .design-switcher .ds-menu .ds-mn{opacity:0.55;font-size:11px;font-variant-numeric:tabular-nums}
    @media(max-width:480px){.design-switcher .ds-label{min-width:80px;font-size:10px}.design-switcher .ds-label .ds-name{display:none}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'design-switcher';
  wrap.innerHTML = `
    <button class="ds-prev" title="Previous design (${prev.name})" aria-label="Previous design">‹</button>
    <button class="ds-label" title="Pick a design">
      <span class="ds-num">${cur.n}</span>
      <span class="ds-name">${cur.name}</span>
    </button>
    <button class="ds-next" title="Next design (${next.name})" aria-label="Next design">›</button>
    <div class="ds-menu">
      ${TAKES.map(t => `<a href="take-${t.n}.html" class="${t.n===cur.n?'cur':''}"><span>${t.name}</span><span class="ds-mn">${t.n}</span></a>`).join('')}
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelector('.ds-prev').addEventListener('click', () => location.href = `take-${prev.n}.html`);
  wrap.querySelector('.ds-next').addEventListener('click', () => location.href = `take-${next.n}.html`);
  wrap.querySelector('.ds-label').addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) wrap.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); location.href = `take-${next.n}.html`; }
    if (e.shiftKey && e.key === 'ArrowLeft')  { e.preventDefault(); location.href = `take-${prev.n}.html`; }
  });
})();
