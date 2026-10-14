/* Shared helpers for the real estate / plan mockups: formatting, icons, charts, shell, finance maths.
   Output follows design/DESIGN-SYSTEM.md; CSS comes from design/cofre-estilos-completos.css. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const nf = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (n) => nf.format(n) + ' €';
const eurS = (n) => (n >= 0 ? '+' : '−') + eur(Math.abs(n));
const num = (n, d = 2) => new Intl.NumberFormat('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const pct = (n, d = 2) => num(n, d) + '%';
const my = (ym) => ym.slice(5, 7) + '/' + ym.slice(0, 4);
const dmy = (ym, d = '01') => d + '/' + ym.slice(5, 7) + '/' + ym.slice(0, 4);
const addMonths = (ym, k) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
};
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ---------- icons (same set as the prototype + a few new ones) ---------- */
const I = {
  home: '<path d="M3 11 12 4l9 7M5 10v10h14V10"/>',
  bank: '<path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3 3 8h18z"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/>',
  cog: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  down: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-2.6-.6-.6-2.6z"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h1M12 12h1M16 12h0M8 16h1M12 16h1M16 16h0"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14a6 6 0 0 1 3.5 6"/>',
  flag: '<path d="M5 21V4M5 5h12l-2 4 2 4H5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};
const ico = (k, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;

/* ---------- finance maths ---------- */
const pmt = (bal, rate, n) => (rate === 0 ? bal / n : (bal * (rate / 12)) / (1 - Math.pow(1 + rate / 12, -n)));
/** French amortization rows [n, ym, capital, interest, fees, tax, life, home, credit, total] */
function annuity(balance, rate, months, startN, startYM, ins = { life: 0, home: 0, credit: 0 }) {
  const rows = [];
  const p = pmt(balance, rate, months);
  let b = balance;
  for (let i = 0; i < months; i++) {
    const int = r2((b * rate) / 12);
    const cap = i === months - 1 ? r2(b) : r2(p - int);
    b = r2(b - cap);
    rows.push([startN + i, addMonths(startYM, i), cap, int, 0, 0, ins.life, ins.home, ins.credit, r2(cap + int + ins.life + ins.home + ins.credit)]);
  }
  return rows;
}

/* ---------- people / palette ---------- */
const PEOPLE = [
  ['Rui', '#F2913D'], ['Ana', '#9D6BFF'], ['Liliana', '#3CCB7F'], ['Simão', '#3BA7F2'], ['Vicente', '#E356A8'],
];
const avatar = (n, c) => `<span class="av" style="background:${c}">${n[0]}</span>`;
const C = { capital: '#9D6BFF', interest: '#F2913D', ins: '#3BA7F2', fees: '#E5424D', teal: '#2BC6B4', yellow: '#F2C43D', green: '#3CCB7F', grey: '#8C8FB8', pink: '#E356A8' };

/* ---------- shell ---------- */
function sidebar(active, { free = false, property = 'Apartamento T3', switcher = '' } = {}) {
  const a = (id, label, icon, extra = '') => `<a href="#" ${active === id ? 'aria-current="page"' : ''}>${ico(icon)}${label}${extra}</a>`;
  const sub = (name, color, cur) => `<a class="sub" href="#" ${cur ? 'aria-current="page"' : ''}><i style="background:${color}"></i>${name}</a>`;
  const proTag = free ? '<span class="pro-chip" style="margin-left:auto">PRO</span>' : '';
  const sw = switcher ? `<div class="pool-sw"><button class="pool-btn ${switcher === 'open' ? 'open' : ''}"><span class="type-ico" style="width:30px;height:30px;background:#F2913D2e;color:#F2913D">${ico('users')}</span><span class="pn"><b>Família Rocha</b><small>Proprietário · Pro</small></span>${ico('chevron')}</button>${switcher === 'open' ? `<div class="pool-menu"><span class="eyebrow">Os teus agregados</span><a class="cur"><span class="type-ico" style="width:26px;height:26px;background:#F2913D2e;color:#F2913D">${ico('users')}</span><span class="pn"><b>Família Rocha</b><small>Proprietário · Pro</small></span>${ico('check')}</a><a><span class="type-ico" style="width:26px;height:26px;background:#3BA7F22e;color:#3BA7F2">${ico('users')}</span><span class="pn"><b>Casa de Família Silva</b><small>Membro · 2 pessoas</small></span></a><div class="menu-sep"></div><a>${ico('plus')}<span>Criar agregado</span></a><a>${ico('users')}<span>Todos os agregados</span></a></div>` : ''}</div>` : '';
  return `<aside class="side"><div class="brand"><b>COFRE</b><span>FINANÇAS FAMILIARES</span></div>${sw}
  <nav class="nav">
    <div class="nav-h">Geral</div>${a('geral', 'Visão geral', 'home')}
    <div class="nav-h">Investimentos</div>${a('portfolios', 'Portfolios', 'pie')}
    ${sub('Longo prazo', '#9D6BFF')}${sub('Dividendos', '#F2913D')}${sub('Fundo de emergência', '#F2C43D')}${sub('Obras', '#2BC6B4')}${sub('PPR – Long term', '#3BA7F2')}
    ${a('objetivos', 'Objetivos', 'target')}
    <div class="nav-h">Património</div>${a('imobiliario', 'Imobiliário', 'home', proTag)}
    ${active === 'imovel' ? sub(property, '#F2913D', true) : ''}
    <div class="nav-h">Dia a dia</div>${a('despesas', 'Despesas', 'receipt')}${a('contas', 'Contas e poupanças', 'bank')}
    <div class="nav-h">App</div>${a('definicoes', 'Definições', 'cog')}${a('estilo', 'Guia de estilo', 'palette')}
  </nav>
  <div class="side-foot"><div class="save-status ok"><i></i><span>Guardado</span></div>
  <div class="theme-tg"><svg class="ico" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><button class="switch" aria-label="Alternar tema"></button>
  <svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></div></div></aside>`;
}
const topbar = (title, { pro = false } = {}) => `<header class="top"><button class="btn icon menu-btn" aria-label="Abrir menu"><svg class="ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
  <h1>${title}${pro ? ' <span class="pro-chip lg">PRO</span>' : ''}</h1>
  <label class="search"><svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input placeholder="Ticker ou movimento"></label>
  <button class="btn primary">${ico('plus')}Transação</button>
  <div class="who"><span class="avatars">${PEOPLE.slice(0, 3).map(([n, c]) => avatar(n, c)).join('')}</span><span class="nm">Rui &amp; Ana &amp; Liliana &amp; Simão &amp; Vicente</span></div></header>`;

const card = (title, body, { cls = 'c12', sub = '', actions = '', style = '' } = {}) =>
  `<div class="card ${cls}" style="${style}"><div class="card-h"><h3>${title}</h3>${actions}</div>${sub ? `<span class="card-sub">${sub}</span>` : ''}${body}</div>`;
const pagebar = (sub, actions = '') => `<div class="toolbar" style="margin:-8px 0 16px"><span class="card-sub grow">${sub}</span>${actions}</div>`;
const tabs = (items, active) => `<div class="tabs" role="tablist">${items.map((t, i) => `<button role="tab" aria-selected="${i === active}">${t}</button>`).join('')}</div>`;
const btn = (label, { icon, primary, sm, lock, ghost, danger } = {}) =>
  `<button class="btn ${primary ? 'primary' : ''} ${sm ? 'sm' : ''} ${ghost ? 'ghost' : ''} ${danger ? 'danger' : ''}">${icon ? ico(icon) : ''}${label}${lock ? ico('lock') : ''}</button>`;

const CSS_EXTRA = `
.pro-chip{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 7px;border-radius:999px;background:var(--grad-violet);color:#fff;font-size:10px;font-weight:800;letter-spacing:.08em;vertical-align:middle}
.pro-chip.lg{height:22px;padding:0 9px;font-size:11px;margin-left:6px}
.chip.demo{background:transparent;border:1px dashed var(--warn);color:var(--warn)}
.btn .ico:last-child:not(:first-child){opacity:.75}
.tl{display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none}
.tl li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;padding:0 0 18px;position:relative}
.tl li:last-child{padding-bottom:0}
.tl li::before{content:"";position:absolute;left:13px;top:28px;bottom:0;width:2px;background:var(--line)}
.tl li:last-child::before{display:none}
.tl .dot{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--panel-2);color:var(--fg-2)}
.tl .dot .ico{width:14px;height:14px}
.tl b{font-size:var(--fs-md)}
.tl .when{font-size:var(--fs-xs);color:var(--fg-3);font-weight:600}
.tl p{margin:2px 0 0;font-size:var(--fs-sm);color:var(--fg-2)}
.deltaline{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
table tfoot td{border-top:1px solid var(--line-2);font-weight:700;border-bottom:0}
tr.proj td{color:var(--fg-2)}
tr.cur td{background:var(--accent-soft)}
.phase{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:2px 12px;font-size:var(--fs-sm);padding:8px 0;border-top:1px solid var(--line)}
.phase small{color:var(--fg-3);font-size:var(--fs-xs)}
.compare{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);font-size:var(--fs-md)}
.compare>div{padding:9px 10px;border-bottom:1px solid var(--line)}
.compare .h{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--fg-3);font-weight:600}
.compare .pro{background:var(--accent-soft)}
.compare .v{text-align:right;font-weight:600}
.planbox{border:1px solid var(--line-2);border-radius:var(--r-md);padding:var(--s4);display:flex;flex-direction:column;gap:var(--s2)}
.planbox.pro{border-color:var(--accent-2);box-shadow:0 0 0 1px var(--accent-2) inset}
.benefit{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:start;font-size:var(--fs-md)}
.benefit .tick{width:22px;height:22px;border-radius:50%;background:var(--accent-soft);color:var(--accent-2);display:grid;place-items:center}
.benefit .tick .ico{width:13px;height:13px;stroke-width:2.4}
.pop{position:absolute;right:0;top:36px;width:340px;z-index:5;background:var(--panel);border:1px solid var(--line-2);border-radius:var(--r-lg);box-shadow:0 24px 64px rgba(0,0,0,.35);padding:var(--s4);display:flex;flex-direction:column;gap:6px}
.pop-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.pop-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;font-size:var(--fs-md);cursor:pointer}
.pop-row small{font-size:var(--fs-xs);color:var(--fg-3);font-weight:500}
.tgl{width:34px;height:20px;border-radius:999px;background:var(--inset);border:1px solid var(--line-2);position:relative;flex:none}
.tgl i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--fg-3)}
.tgl.on{background:var(--accent);border-color:var(--accent)}.tgl.on i{left:16px;background:#fff}.tgl.dis{opacity:.5}
.auth{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)}
.auth-brand{position:relative;overflow:hidden;padding:48px 56px;display:flex;flex-direction:column;gap:32px;background:radial-gradient(120% 90% at 0% 0%,#3a2a8f 0%,transparent 55%),radial-gradient(90% 80% at 100% 100%,#6a2bd9 0%,transparent 60%),#1F2044;color:#F2F2FB}
:root[data-theme="light"] .auth-brand{background:radial-gradient(120% 90% at 0% 0%,#8b55f5 0%,transparent 55%),radial-gradient(90% 80% at 100% 100%,#5b21c9 0%,transparent 62%),#7c5cff}
.auth-brand .brand b{font-size:30px;background:none;-webkit-background-clip:initial;color:#fff}
.auth-brand .brand span{color:rgba(255,255,255,.75)}
.auth-brand h2{font-size:34px;line-height:1.15;font-weight:800;letter-spacing:-.02em;margin:auto 0 0;max-width:460px}
.auth-brand p{margin:0;font-size:15px;color:rgba(255,255,255,.82);max-width:440px}
.auth-brand ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;font-size:14px}
.auth-brand li{display:flex;gap:10px;align-items:center}
.auth-brand li .ico{width:18px;height:18px;padding:3px;border-radius:50%;background:rgba(255,255,255,.18);stroke-width:2.6}
.auth-deco{position:absolute;right:40px;top:84px;width:300px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:16px;backdrop-filter:blur(6px);transform:rotate(3deg)}
.auth-deco small{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;font-weight:600}
.auth-deco b{font-size:24px;font-weight:800;display:block;margin:4px 0 8px}
.auth-main{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 32px;gap:20px;background:var(--bg)}
.auth-card{width:min(420px,100%);background:var(--panel);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:32px;display:flex;flex-direction:column;gap:18px}
.auth-card h1{font-size:var(--fs-2xl);font-weight:700;letter-spacing:-.01em}
.auth-card .lead{margin:-10px 0 0;color:var(--fg-2);font-size:var(--fs-md)}
.auth-card form{display:flex;flex-direction:column;gap:14px}
.auth-card .btn.lg{height:42px;width:100%;font-size:var(--fs-base)}
.auth-foot{font-size:var(--fs-sm);color:var(--fg-3);text-align:center;max-width:420px}
.auth-foot a,.auth-card a,.link{color:var(--accent-2);font-weight:600;text-decoration:none;cursor:pointer}
.auth-top{display:none}
.iw{position:relative;display:flex}
.iw .input{height:40px;padding-right:40px}
.iw .ico.l{position:absolute;left:12px;top:11px;width:18px;height:18px;color:var(--fg-3)}
.iw.has-l .input{padding-left:38px}
.iw .eye{position:absolute;right:6px;top:5px;width:30px;height:30px;display:grid;place-items:center;color:var(--fg-3);border-radius:6px}
.input.err{border-color:var(--neg);box-shadow:0 0 0 1px var(--neg) inset}
.input.dis{opacity:.6}
.alert{display:flex;gap:10px;align-items:flex-start;border-radius:var(--r-md);padding:10px 12px;font-size:var(--fs-md);border:1px solid}
.alert .ico{width:18px;height:18px;margin-top:1px}
.alert.err{background:rgba(242,90,100,.12);border-color:var(--neg);color:var(--fg)}.alert.err .ico{color:var(--neg)}
.alert.warn{background:rgba(242,166,61,.12);border-color:var(--warn)}.alert.warn .ico{color:var(--warn)}
.alert.ok{background:rgba(60,203,127,.12);border-color:var(--pos)}.alert.ok .ico{color:var(--pos)}
.alert.info{background:var(--accent-soft);border-color:var(--accent)}.alert.info .ico{color:var(--accent-2)}
.fr{display:flex;justify-content:space-between;align-items:center}
.meter-pw{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.meter-pw i{height:4px;border-radius:4px;background:var(--inset)}
.reqs{display:flex;flex-direction:column;gap:5px;font-size:var(--fs-sm);color:var(--fg-2)}
.reqs div{display:flex;gap:7px;align-items:center}.reqs .ico{width:14px;height:14px;stroke-width:2.6}
.reqs .ok{color:var(--pos)}.reqs .no{color:var(--fg-3)}
.big-ico{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;align-self:flex-start}
.big-ico .ico{width:28px;height:28px}
.pool-card{display:flex;flex-direction:column;gap:12px;border:1px solid transparent;cursor:pointer}
.pool-card:hover{border-color:var(--accent-2)}
.divider{display:flex;align-items:center;gap:10px;color:var(--fg-3);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.08em}
.divider::before,.divider::after{content:"";height:1px;background:var(--line);flex:1}
.who-box{display:flex;gap:10px;align-items:center;background:var(--inset);border-radius:var(--r-md);padding:10px 12px}
.pool-top{display:flex;align-items:center;gap:var(--s3);padding:20px 32px}
@media (max-width:860px){.auth{grid-template-columns:minmax(0,1fr)}.auth-brand{display:none}.auth-top{display:flex;padding:20px 20px 0;background:var(--bg)}.auth-top .brand b{font-size:24px}.auth-main{justify-content:flex-start;padding:24px 16px 32px}.auth-card{padding:24px 20px}.pool-top{padding:16px}}
.pool-sw{position:relative;margin:-4px 0 -4px}
.pool-btn{all:unset;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-md);background:var(--panel-2);border:1px solid var(--line);cursor:pointer}
.pool-btn.open{border-color:var(--accent-2)}.pool-btn>.ico:last-child{margin-left:auto;transform:rotate(90deg);color:var(--fg-3);width:16px;height:16px}
.pn{display:flex;flex-direction:column;min-width:0;line-height:1.2}.pn b{font-size:13px}.pn small{font-size:11px;color:var(--fg-3)}
.pool-menu{position:absolute;left:0;right:0;top:54px;z-index:20;background:var(--panel);border:1px solid var(--line-2);border-radius:var(--r-lg);box-shadow:0 18px 48px rgba(0,0,0,.35);padding:10px;display:flex;flex-direction:column;gap:2px}
.pool-menu .eyebrow{padding:4px 6px}
.pool-menu a{display:flex;align-items:center;gap:10px;padding:7px 6px;border-radius:var(--r-sm);font-size:13px;color:var(--fg-2);cursor:pointer}
.pool-menu a:hover,.pool-menu a.cur{background:var(--panel-2);color:var(--fg)}.pool-menu a>.ico:last-child{margin-left:auto;color:var(--pos);width:16px;height:16px}.pool-menu a .ico{width:16px;height:16px}
.menu-sep{height:1px;background:var(--line);margin:4px 0}
.hero-pro{display:grid;place-items:center;width:52px;height:52px;border-radius:14px;background:var(--grad-violet);color:#fff;box-shadow:0 10px 24px -8px var(--accent)}
.hero-pro .ico{width:26px;height:26px}
`;

/* ---------- charts ---------- */
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
/** stacked bars; data [{label, segs:[{v,color,faded}]}] */
function stackedBars(data, { w = 760, h = 250, labelEvery = 5, fmt = (v) => num(v / 1000, Number.isInteger(v / 1000) ? 0 : 1) + ' mil' } = {}) {
  const L = 46, B = 24, T = 8, R = 6;
  const top = Math.max(...data.map((d) => sum(d.segs, (s) => s.v)));
  const stepRaw = top / 4, p10 = Math.pow(10, Math.floor(Math.log10(stepRaw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((v) => v >= stepRaw);
  const ticks = Math.ceil(top / step);
  const max = step * ticks;
  const pw = w - L - R, ph = h - B - T, bw = (pw / data.length) * 0.62;
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const y = T + ph - (ph * i) / ticks;
    g += `<line class="grid-l" x1="${L}" x2="${w - R}" y1="${y}" y2="${y}"/><text class="axis" x="${L - 8}" y="${y + 3}" text-anchor="end">${fmt(step * i)}</text>`;
  }
  data.forEach((d, i) => {
    const x = L + (pw / data.length) * i + ((pw / data.length) - bw) / 2;
    let y = T + ph;
    d.segs.forEach((s) => {
      const hh = (s.v / max) * ph;
      y -= hh;
      g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(hh, 0).toFixed(1)}" fill="${s.color}" opacity="${s.faded ? 0.38 : 1}"/>`;
    });
    if (i % labelEvery === 0 || i === data.length - 1) g += `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle">${d.label}</text>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img">${g}</svg></div>`;
}
/** step line with area; points [{x:0..1,y}] ; yMax */
function stepChart(pts, { w = 560, h = 230, yMax = 5, labels = [], marks = [], color = C.interest, projFrom = 1 } = {}) {
  const L = 40, B = 24, T = 10, R = 12;
  const pw = w - L - R, ph = h - B - T;
  const X = (x) => L + x * pw, Y = (y) => T + ph - (y / yMax) * ph;
  let g = '';
  for (let i = 0; i <= 5; i++) {
    const v = (yMax * i) / 5, y = Y(v);
    g += `<line class="grid-l" x1="${L}" x2="${w - R}" y1="${y}" y2="${y}"/><text class="axis" x="${L - 8}" y="${y + 3}" text-anchor="end">${num(v, 0)}%</text>`;
  }
  let d = '';
  pts.forEach((p, i) => { d += (i ? `H${X(p.x).toFixed(1)}V${Y(p.y).toFixed(1)}` : `M${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`); });
  const last = pts[pts.length - 1];
  const dEnd = d + `H${X(1).toFixed(1)}`;
  const id = 'sg' + Math.round(Math.random() * 1e6);
  g += `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
  g += `<path d="${dEnd}V${Y(0)}H${X(0)}Z" fill="url(#${id})"/><path d="${d}H${X(projFrom).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>`;
  g += `<path d="M${X(projFrom).toFixed(1)},${Y(last.y).toFixed(1)}H${X(1).toFixed(1)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-dasharray="5 5" opacity=".8"/>`;
  marks.forEach((m) => { g += `<circle cx="${X(m.x).toFixed(1)}" cy="${Y(m.y).toFixed(1)}" r="4.5" fill="var(--panel)" stroke="${m.color || color}" stroke-width="2.2"/>`; });
  labels.forEach((l) => { g += `<text class="axis" x="${X(l.x).toFixed(1)}" y="${h - 6}" text-anchor="middle">${l.t}</text>`; });
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img">${g}</svg></div>`;
}
function donut(items, centerTop, centerSub) {
  const total = sum(items, (i) => i[2]);
  const r = 62, c = 2 * Math.PI * r;
  let off = 0, arcs = '';
  items.forEach(([col, , v]) => {
    const len = (v / total) * c;
    arcs += `<circle cx="84" cy="84" r="${r}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${Math.max(len - 2, 0).toFixed(2)} ${(c - len + 2).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 84 84)"/>`;
    off += len;
  });
  const svg = `<svg width="168" height="168" viewBox="0 0 168 168"><circle cx="84" cy="84" r="${r}" fill="none" stroke="var(--inset)" stroke-width="18"/>${arcs}<text x="84" y="82" text-anchor="middle" font-size="15" font-weight="800" fill="var(--fg)">${centerTop}</text><text x="84" y="98" text-anchor="middle" font-size="10" fill="var(--fg-3)">${centerSub}</text></svg>`;
  const legend = `<div class="legend">${items.map(([col, l, v]) => `<div class="li"><i class="sw" style="background:${col}"></i><span>${l}</span><b class="num">${eur(v)}</b><span class="p">${num((v / total) * 100, 1)}%</span></div>`).join('')}</div>`;
  return `<div class="donut-wrap">${svg}${legend}</div>`;
}

/* ---------- HTML document ---------- */
function doc({ theme, body, modal = '', mobile = false, bare = false }) {
  const css = fs.readFileSync(path.join(ROOT, 'design/cofre-estilos-completos.css'), 'utf8');
  const f = (file) => 'file://' + path.join(ROOT, 'design/fonts', file);
  const faces = [['Plus Jakarta Sans', 400], ['Plus Jakarta Sans', 500], ['Plus Jakarta Sans', 600], ['Plus Jakarta Sans', 700], ['Plus Jakarta Sans', 800], ['JetBrains Mono', 500], ['JetBrains Mono', 600]]
    .map(([n, w]) => `@font-face{font-family:"${n}";font-weight:${w};src:url("${f(n.toLowerCase().replace(/ /g, '-') + '-latin-' + w + '-normal.woff2')}") format("woff2")}`).join('\n');
  return `<!doctype html><html lang="pt-PT" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${faces}\n${css}\n${CSS_EXTRA}</style></head><body>${bare ? body : `<div class="app">${body}</div>`}${modal}</body></html>`;
}
const page = (active, title, content, opts = {}) =>
  `${sidebar(active, opts)}<main class="main">${topbar(title, opts)}${opts.banner || ''}${content}</main>`;
const modalShell = ({ title, body, footer, wide = false, icon = '' }) =>
  `<div class="modal-bg"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-h"><h2>${icon}${title}</h2><button class="btn ghost icon" aria-label="Fechar">${ico('x')}</button></div><div class="modal-b">${body}</div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div></div>`;
const field = (label, input, hint = '', full = false) => `<div class="f ${full ? 'full' : ''}"><label>${label}</label>${input}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
const inp = (v = '', attrs = '') => `<input class="input" value="${v}" ${attrs}>`;
const select = (opts, sel) => `<select class="input">${opts.map((o) => `<option ${o === sel ? 'selected' : ''}>${o}</option>`).join('')}</select>`;

module.exports = { fs, path, ROOT, eur, eurS, num, pct, my, dmy, addMonths, sum, r2, ico, pmt, annuity, PEOPLE, avatar, C, sidebar, topbar, card, pagebar, tabs, btn, stackedBars, stepChart, donut, doc, page, modalShell, field, inp, select, niceMax };
