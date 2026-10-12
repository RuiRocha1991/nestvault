const L = require('./lib.cjs');
const { eur, eurS, num, pct, my, dmy, sum, r2, ico, card, pagebar, tabs, btn, stackedBars, stepChart, donut, page, modalShell, field, inp, select, C, pmt, addMonths } = L;
const { pro, demo, contractYears } = require('./model.cjs');

const chip = (t, cls = '') => `<span class="chip ${cls}">${t}</span>`;
const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const stat = (label, value, small = '') => `<div class="stat"><small>${label}</small><b class="num">${value}</b>${small ? `<small>${small}</small>` : ''}</div>`;
const holders = (m) => m.holders.map(([n, c, p]) => `<span style="display:inline-flex;align-items:center;gap:4px">${L.avatar(n, c)}<span class="fg2" style="font-size:12px">${n} ${p}%</span></span>`).join(' ');
const PROP_TABS = ['Resumo', 'Prestações', 'Eventos e anos', 'Obras', 'Venda e simulador'];
const typeIco = (color = '#F2913D') => `<span class="type-ico" style="background:${color}2e;color:${color}">${ico('home')}</span>`;

/* ---------- Free preview helpers ---------- */
const demoBanner = (what) => `<div class="banner">${ico('lock')}<p><b>Estás a ver dados de exemplo do ${what}.</b> Faz parte do plano Pro: podes explorar as páginas, mas os valores são fictícios e todas as ações pedem para ativar o Pro.</p><button class="btn primary">${ico('spark')}Ativar Pro</button></div>`;

/* ================= 27 · Imobiliário (lista) ================= */
function imobiliarioLista(m = pro, { free = false } = {}) {
  const amortPct = (m.capitalPaid / m.principal) * 100;
  const prop = `<div class="card acc" style="gap:14px">
    <div class="card-h">${typeIco()}<div style="display:flex;flex-direction:column;min-width:0"><h3 style="margin:0">${m.name}</h3><span class="card-sub">${m.kind} · ${m.holders.map(([n, , p]) => n + ' ' + p + '%').join(' · ')}</span></div>${free ? chip('EXEMPLO', 'demo') : chip('Casa de morada', 'accent')}</div>
    <div><span class="eyebrow">Capital próprio</span><div class="big num">${eur(m.equity)}</div></div>
    ${kv([['Valor estimado', `${eur(m.value)} <small class="muted">${my(m.valueYM)}</small>`], ['Dívida em aberto', `<span class="neg">${eur(m.debt)}</span>`], ['Prestação atual', eur(m.next[9])], ['Taxa', `${pct(m.rate)} <small class="muted">${m.index} + ${pct(m.spread)}</small>`], ['Total investido', eur(m.invested)], ['Obras', `${eur(m.worksPaid)} <small class="muted">${m.works.length} projetos</small>`]])}
    <div><div class="bar thick" style="margin:0 0 6px"><i style="width:${amortPct.toFixed(1)}%"></i></div><div class="toolbar" style="justify-content:space-between"><span class="card-sub">${num(amortPct, 1)}% do empréstimo amortizado</span><span class="card-sub">fim em ${my(m.endYM)}</span></div></div>
    <div class="acts">${btn('Abrir', { primary: true })}${btn('Editar', { icon: 'edit', lock: false })}<span style="flex:1"></span><button class="btn ghost danger icon" aria-label="Apagar">${ico('trash')}</button></div></div>`;
  const loanRow = `<tr class="click"><td><div class="asset-cell"><span class="type-ico" style="background:#E5424D2e;color:#E5424D;width:30px;height:30px">${ico('bank')}</span><div class="nm"><b>Crédito habitação</b><span>${m.index} + ${pct(m.spread)}</span></div></div></td><td class="num">${eur(m.principal)}</td><td class="num">${eur(m.debt)}</td><td class="num">${eur(m.next[9])}<small>${dmy(m.next[1])}</small></td><td class="num">${pct(m.rate)}</td><td class="num">${my(m.endYM)}<small>${m.remaining} prestações</small></td></tr>`;
  const strip = card('Resumo do imobiliário', `<div class="strip">
      <div class="it"><span class="eyebrow">Valor estimado</span><b class="num">${eur(m.value)}</b></div>
      <div class="it"><span class="eyebrow">Dívida em aberto</span><b class="num neg">${eur(m.debt)}</b></div>
      <div class="it"><span class="eyebrow">Capital próprio</span><b class="num pos">${eur(m.equity)}</b></div>
      <div class="it"><span class="eyebrow">Prestações / mês</span><b class="num">${eur(m.next[9])}</b></div>
      <div class="it"><span class="eyebrow">Obras pagas</span><b class="num">${eur(m.worksPaid)}</b></div></div>`,
    { sub: 'Os imóveis entram no património líquido pelo valor estimado; os empréstimos entram como passivo.' });
  const upcoming = card('A seguir', `<div class="blist">
      <div class="r"><span class="n">Prestação ${m.next[0]}</span><span class="v">${eur(m.next[9])}</span><span class="card-sub">${dmy(m.next[1])} · Conta à ordem Banco A</span></div>
      <div class="r"><span class="n">Revisão da taxa (${m.index})</span><span class="v">${m.nextReview}</span><span class="card-sub">Revisões em março e setembro</span></div>
      <div class="r"><span class="n">Seguro multirriscos</span><span class="v">${eur(m.next[7])}</span><span class="card-sub">Incluído na prestação · mensal</span></div></div>`, { cls: '', style: 'flex:1' });
  const nw = card('No património líquido', `<div class="meters"><div class="meter-row"><span class="l">Imóveis</span><span class="v pos num">+${eur(m.value)}</span><span class="m"></span></div><div class="meter-row"><span class="l">Empréstimos</span><span class="v neg num">−${eur(m.debt)}</span><span class="m"></span></div><div class="meter-row" style="border-top:1px solid var(--line);padding-top:10px"><span class="l"><b>Efeito líquido</b></span><span class="v num">${eur(m.equity)}</span><span class="m"></span></div></div>`, { cls: '' });
  const drop = free ? 'Taxa mantida na última revisão' : 'Taxa desceu de 4,10% para 2,40%';
  const rate = card('Taxa e prestação', `${kv([['Indexante', `${m.index} ${pct(m.euribor)}`], ['Spread', pct(m.spread)], ['Taxa atual', `<b>${pct(m.rate)}</b>`], ['Próxima revisão', m.nextReview]])}<div class="deltaline">${chip(drop, 'pos')}</div>`, { cls: '', style: 'flex:1' });
  const actions = `${btn('Importar folha de cálculo', { icon: 'down', lock: free })}${btn('Adicionar imóvel', { icon: 'plus', primary: true, lock: free })}`;
  const col = (x) => `<div style="display:flex;flex-direction:column;gap:var(--s4);min-width:0;height:100%">${x}</div>`;
  const loans = `<div class="card"><div class="card-h"><h3>Empréstimos</h3>${btn('Novo empréstimo', { sm: true, icon: 'plus', lock: free })}</div><div class="tbl-wrap"><table><thead><tr><th>Empréstimo</th><th class="num">Capital inicial</th><th class="num">Em dívida</th><th class="num">Próxima prestação</th><th class="num">Taxa</th><th class="num">Fim</th></tr></thead><tbody>${loanRow}</tbody></table></div>
      <div class="empty" style="padding:var(--s4);flex-direction:row;justify-content:center;gap:var(--s4)"><span class="fg2">Outros empréstimos (automóvel, pessoal) também ficam aqui.</span>${btn('Adicionar empréstimo', { sm: true, icon: 'plus', lock: free })}</div></div>`;
  const content = `${pagebar('Imóveis, empréstimos e obras da família. As prestações separam capital (poupança) de juros e seguros (despesa).', actions)}
  <div class="grid">${strip}
    <div class="c4">${col(prop + nw)}</div>
    <div class="c8">${col(loans + `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s4);flex:1">${upcoming}${rate}</div>`)}</div></div>`;
  return page('imobiliario', 'Imobiliário', content, { free, pro: free, banner: free ? demoBanner('módulo Imobiliário') : '' });
}

/* ================= property header + 28 · Resumo ================= */
const propHeader = (m, active, free) => `${pagebar(`${m.kind} · titulares ${holders(m)}`, `${btn('Evento do empréstimo', { icon: 'flag', lock: free })}${btn('Editar imóvel', { icon: 'edit', lock: free })}`)}${tabs(PROP_TABS, active)}`;

function imovelResumo(m = pro, { free = false } = {}) {
  const yrs = contractYears(m);
  const bars = yrs.map((y) => ({ label: String(y.start), segs: [{ v: y.cp, color: C.capital }, { v: y.cj, color: C.capital, faded: true }, { v: y.ip, color: C.interest }, { v: y.ij, color: C.interest, faded: true }] }));
  const amortPct = (m.capitalPaid / m.principal) * 100;
  const hero = `<div class="card c12"><div class="hero"><div style="display:flex;flex-direction:column;gap:6px"><span class="eyebrow">Capital próprio</span><div class="big num">${eur(m.equity)}</div><span class="card-sub">Valor estimado − dívida em aberto</span><div class="deltaline">${chip(`${num(amortPct, 1)}% amortizado`, 'pos')}${chip(`${m.paidCount} de ${m.totalCount} prestações`)}${free ? chip('EXEMPLO', 'demo') : ''}</div></div>
    <div class="stats">${stat('Valor estimado', eur(m.value), `${m.valueSource} · ${my(m.valueYM)}`)}${stat('Dívida em aberto', `<span class="neg">${eur(m.debt)}</span>`, `fim em ${my(m.endYM)}`)}${stat('Capital amortizado', eur(m.capitalPaid), m.prepayments.length ? `inclui ${eur(m.prepayments[0].amount)} antecipados` : 'só prestações')}${stat('Prestação atual', eur(m.next[9]), `taxa ${pct(m.rate)}`)}${stat('Total investido', eur(m.invested), 'entrada + capital + custos + obras')}${stat('Custo do crédito', eur(m.costCredit), 'juros, comissões e seguros')}</div></div></div>`;
  const loanBar = card('Empréstimo · Crédito habitação', `<div class="bar thick" style="margin:2px 0 4px"><i style="width:${amortPct.toFixed(1)}%"></i></div><div class="toolbar" style="justify-content:space-between"><span class="fg2" style="font-size:12px"><b class="num" style="color:var(--fg)">${eur(m.capitalPaid)}</b> pagos (${num(amortPct, 1)}%)</span><span class="fg2" style="font-size:12px"><b class="num" style="color:var(--fg)">${eur(m.debt)}</b> em falta</span></div>`, { sub: `${eur(m.principal)} a ${m.termMonths} meses desde ${my(m.startYM)} · ${m.index} + ${pct(m.spread)}` });
  const chart = card('Capital e juros por ano do contrato', `<div class="series-key"><span><i style="background:${C.capital}"></i>Capital</span><span><i style="background:${C.interest}"></i>Juros</span><span><i style="background:var(--fg-3);opacity:.45"></i>Projetado</span></div>${stackedBars(bars, { w: 760, h: 296, labelEvery: yrs.length > 30 ? 5 : 4 })}`, { cls: 'c8', sub: 'Cada barra soma as prestações de 12 meses (sem seguros). Anos futuros são projetados com a taxa atual.' });
  const spent = donut([[C.capital, 'Capital pago', m.capitalPaid], ['#6C5CFF', 'Entrada', m.down], [C.teal, 'Obras', m.worksPaid], [C.interest, 'Juros', m.interestPaid], [C.ins, 'Seguros', m.lifePaid + m.homePaid + m.creditPaid], [C.yellow, 'Custos de aquisição', m.acq], [C.grey, 'Comissões e selo', m.feesPaid]].filter((x) => x[2] > 0), eur(m.totalSpent).replace(/ €/, ' €'), 'total gasto');
  const where = card('Para onde foi o dinheiro', spent, { cls: 'c4' });
  const up = m.projRows.slice(0, 4);
  const upcoming = card('Próximas prestações', `<div class="tbl-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th class="num">Capital</th><th class="num">Juros</th><th class="num">Seguros</th><th class="num">Total</th></tr></thead><tbody>${up.map((r) => `<tr class="proj"><td>${r[0]}</td><td>${dmy(r[1])}</td><td class="num">${eur(r[2])}</td><td class="num">${eur(r[3])}</td><td class="num">${eur(r[6] + r[7] + r[8])}</td><td class="num"><b>${eur(r[9])}</b></td></tr>`).join('')}</tbody></table></div><span class="card-sub">Projetadas · passam a reais quando ligas o débito do banco.</span>`, { cls: 'c6' });
  const ev = m.events.slice(-3).reverse();
  const recent = card('Eventos recentes', `<ul class="tl">${ev.map(eventLi).join('')}</ul>`, { cls: 'c6' });
  const content = `${propHeader(m, 0, free)}<div class="grid">${hero}${loanBar}${chart}${where}${upcoming}${recent}</div>`;
  return page('imovel', m.name, content, { free, pro: free, property: m.name, banner: free ? demoBanner('módulo Imobiliário') : '' });
}
const eventLi = (e) => {
  const [ic, col] = { contract: ['file', '#6C5CFF'], review: ['trend', '#F2913D'], prepay: ['down', '#3CCB7F'], reneg: ['swap', '#3BA7F2'] }[e.kind];
  return `<li><span class="dot" style="background:${col}2e;color:${col}">${ico(ic)}</span><div><span class="when">${my(e.ym)}</span><br><b>${e.title}</b><p>${e.text}</p></div></li>`;
};

/* ================= 29 · Prestações ================= */
function imovelPrestacoes(m = pro) {
  const rows = [...m.paidRows.map((r) => ({ r, proj: false })), ...m.projRows.map((r) => ({ r, proj: true }))].filter(({ r }) => r[1].startsWith('2026'));
  const tr = rows.map(({ r, proj }, i) => {
    const linked = !proj && r[0] < 73;
    const isNext = proj && r[0] === m.next[0];
    return `<tr class="${proj ? 'proj' : ''} ${isNext ? 'cur' : ''}"><td>${r[0]}</td><td>${dmy(r[1])}</td><td class="num">${eur(r[2])}</td><td class="num">${eur(r[3])}</td><td class="num">${r[4] + r[5] ? eur(r[4] + r[5]) : '—'}</td><td class="num">${eur(r[6])}</td><td class="num">${eur(r[7])}</td><td class="num">${r[8] ? eur(r[8]) : '—'}</td><td class="num"><b>${eur(r[9])}</b></td><td class="num">${m.totalCount - r[0]}</td><td>${proj ? chip('Projetada') : chip('Paga', 'pos')}</td><td>${proj ? '<span class="muted">—</span>' : linked ? `<span class="chip accent">${ico('link')}Ligada</span>` : `<span class="chip warn">Por ligar</span>`}</td><td><div class="row-acts"><button class="btn ghost icon sm" aria-label="Editar">${ico('edit')}</button></div></td></tr>`;
  }).join('');
  const tot = (i) => sum(rows, ({ r }) => r[i]);
  const foot = `<tfoot><tr><td colspan="2">Total 2026</td><td class="num">${eur(tot(2))}</td><td class="num">${eur(tot(3))}</td><td class="num">${eur(tot(4) + tot(5))}</td><td class="num">${eur(tot(6))}</td><td class="num">${eur(tot(7))}</td><td class="num">${eur(tot(8))}</td><td class="num">${eur(tot(9))}</td><td colspan="4"></td></tr></tfoot>`;
  const toolbar = `<div class="toolbar"><div class="seg" role="group"><button aria-pressed="true">Todas</button><button aria-pressed="false">Pagas</button><button aria-pressed="false">Projetadas</button></div><select class="sel"><option>Ano: 2026</option></select><select class="sel"><option>Todos os estados de ligação</option></select><span class="grow"></span>${btn('Exportar CSV', { sm: true, icon: 'down' })}${btn('Importar prestações', { sm: true, icon: 'down' })}${btn('Prestação', { sm: true, icon: 'plus', primary: true })}</div>`;
  const note = `<div class="note">${ico('info', 'ico').replace('class="ico"', 'class="ico" style="width:14px;height:14px;vertical-align:-2px"')} Quando ligas o débito do banco a uma prestação, só <b>juros, comissões, impostos e seguros</b> contam como despesa; a parte do <b>capital</b> conta como poupança (capital próprio), não como despesa.</div>`;
  const content = `${propHeader(m, 1, false)}<div class="grid"><div class="card c12">${toolbar}<div class="tbl-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th class="num">Capital</th><th class="num">Juros</th><th class="num">Comissões e selo</th><th class="num">Seguro vida</th><th class="num">Seguro casa</th><th class="num">Seguro crédito</th><th class="num">Total</th><th class="num">Em falta</th><th>Estado</th><th>Movimento</th><th></th></tr></thead><tbody>${tr}</tbody>${foot}</table></div>${note}</div></div>`;
  return page('imovel', m.name, content, { property: m.name });
}

/* ================= 30 · Eventos e anos ================= */
function imovelEventos(m = pro) {
  const yrs = contractYears(m).filter((y) => y.paid > 0);
  const body = yrs.map((y) => `<tr><td><b>Ano ${y.n}</b></td><td>${my(y.ym0)} – ${my(addMonths(y.ym0, 11))}${y.paid < 12 ? ` <small>(${y.paid} paga)</small>` : ''}</td><td class="num">${eur(y.cp)}</td><td class="num">${eur(y.ip)}</td><td class="num">${y.fees ? eur(y.fees) : '—'}</td><td class="num">${y.tax ? eur(y.tax) : '—'}</td><td class="num">${eur(y.life)}</td><td class="num">${eur(y.home)}</td><td class="num">${y.credit ? eur(y.credit) : '—'}</td><td class="num"><b>${eur(y.total)}</b></td></tr>`).join('');
  const T = (k) => sum(yrs, (y) => y[k]);
  const foot = `<tfoot><tr><td colspan="2">Total pago em prestações</td><td class="num">${eur(T('cp'))}</td><td class="num">${eur(T('ip'))}</td><td class="num">${eur(T('fees'))}</td><td class="num">${eur(T('tax'))}</td><td class="num">${eur(T('life'))}</td><td class="num">${eur(T('home'))}</td><td class="num">${eur(T('credit'))}</td><td class="num">${eur(T('total'))}</td></tr></tfoot>`;
  const yearly = card('Pago por ano do contrato', `<div class="tbl-wrap"><table><thead><tr><th>Ano</th><th>Período</th><th class="num">Capital</th><th class="num">Juros</th><th class="num">Comissões</th><th class="num">Imposto</th><th class="num">Seguro vida</th><th class="num">Seguro casa</th><th class="num">Seguro crédito</th><th class="num">Total</th></tr></thead><tbody>${body}</tbody>${foot}</table></div><span class="card-sub">Cada ano do contrato agrupa 12 prestações a partir da primeira. Amortização antecipada de ${eur(15000)} (02/2023, ano 3) não está incluída acima.</span>`, { sub: 'Equivale ao separador “Pago por anos” da folha de cálculo.' });

  // implied rate steps
  const n = m.totalCount;
  const segs = [[1, 12, 0.82], [13, 24, 0.61], [25, 37, 2.09], [38, 67, 4.1], [68, 73, 2.4]];
  const total = 85; // months shown (73 paid + 12 projected)
  const X = (k) => (k - 1) / total;
  const pts = []; segs.forEach(([a, , y]) => pts.push({ x: X(a), y }));
  const marks = [[13, 0.61, '#F2913D'], [25, 2.09, '#F2913D'], [37, 4.21, '#F2913D'], [38, 4.1, '#3BA7F2'], [68, 2.4, '#F2913D']].map(([k, y, color]) => ({ x: X(k), y, color }));
  const labels = [[1, '09/2020'], [13, '09/2021'], [25, '09/2022'], [37, '09/2023'], [49, '09/2024'], [61, '09/2025'], [73, '09/2026']].map(([k, t]) => ({ x: X(k), t }));
  const rate = card('Taxa ao longo do tempo', `${stepChart(pts, { w: 640, h: 330, yMax: 5, marks, labels, projFrom: 73 / total })}<div class="series-key"><span><i style="background:${C.interest}"></i>Taxa nominal</span><span><i class="dash"></i>Projeção (taxa atual)</span></div>${kv([['Taxa atual', `<b>${pct(m.rate)}</b> · ${m.index} ${pct(m.euribor)} + spread ${pct(m.spread)}`], ['Próxima revisão', m.nextReview], ['Prestações em falta', `${m.remaining} · fim em ${my(m.endYM)}`]])}`, { cls: 'c7', sub: 'Revisões em março e setembro; o ponto azul marca a renegociação de 10/2023.' });
  const ev = card('Linha do tempo', `<ul class="tl">${m.events.slice().reverse().map(eventLi).join('')}</ul>`, { cls: 'c5', actions: btn('Evento', { sm: true, icon: 'plus' }) });
  const content = `${propHeader(m, 2, false)}<div class="grid">${yearly}${rate}${ev}</div>`;
  return page('imovel', m.name, content, { property: m.name });
}

/* ================= 31 · Obras ================= */
function imovelObras(m = pro, { free = false } = {}) {
  const budget = m.worksBudget, paid = m.worksPaid;
  const done = m.works.filter((w) => w.status === 'Concluído').length, going = m.works.filter((w) => w.status === 'Em curso').length;
  const strip = card('Resumo das obras', `<div class="strip">
      <div class="it"><span class="eyebrow">Orçamentado</span><b class="num">${eur(budget)}</b></div><div class="it"><span class="eyebrow">Pago</span><b class="num pos">${eur(paid)}</b></div>
      <div class="it"><span class="eyebrow">Em dívida</span><b class="num">${eur(budget - paid)}</b></div><div class="it"><span class="eyebrow">Concluídas</span><b class="num">${done}</b></div><div class="it"><span class="eyebrow">Em curso</span><b class="num">${going}</b></div></div>`,
    { cls: 'c12', sub: 'Os pagamentos de obras contam como despesa da categoria Obras e aumentam o total investido no imóvel.', actions: btn('Nova obra', { icon: 'plus', primary: true, sm: true, lock: free }) });
  const work = (w) => {
    const pd = (w.paid / w.total) * 100;
    const ph = w.phases.length
      ? w.phases.map(([n, v, plan, done]) => {
        const late = (new Date(done) - new Date(plan)) / 864e5;
        return `<div class="phase"><span><b>${n}</b><br><small>prevista ${dmy(plan.slice(0, 7), plan.slice(8))}${late ? ` · paga ${dmy(done.slice(0, 7), done.slice(8))} (${late > 0 ? '+' : ''}${late} d)` : ' · paga no dia'}</small></span><span class="num"><b>${eur(v)}</b></span>${chip('Paga', 'pos')}</div>`;
      }).join('')
      : `<div class="phase"><span class="fg2">Pagamento único</span><span class="num"><b>${eur(w.paid)}</b></span>${chip('Pago', 'pos')}</div>`;
    return `<div class="card c6"><div class="card-h"><h3>${w.name}</h3>${chip(w.status, w.status === 'Concluído' ? 'pos' : 'warn')}</div>
      <span class="card-sub">${w.desc}${w.supplier ? ` · <b>${w.supplier}</b>` : ''}</span>
      ${kv([['Orçamento', eur(w.total)], ['Entrada', `${w.depositPct}% · ${eur((w.total * w.depositPct) / 100)}`], ['Pago', `<span class="pos">${eur(w.paid)}</span>`], ['Em falta', eur(w.total - w.paid)]])}
      <div class="bar thick"><i style="width:${pd.toFixed(0)}%;${pd >= 100 ? 'background:var(--pos)' : ''}"></i></div>
      <div><span class="eyebrow">Fases de pagamento</span>${ph}</div>${w.note ? `<div class="note">${w.note}</div>` : ''}</div>`;
  };
  const content = `${propHeader(m, 3, free)}<div class="grid">${strip}${m.works.map(work).join('')}</div>`;
  return page('imovel', m.name, content, { property: m.name, free, pro: free, banner: free ? demoBanner('módulo Imobiliário') : '' });
}

/* ================= 32 · Venda e simulador ================= */
function imovelVenda(m = pro) {
  const sellPct = m.sellCostPct / 100;
  const sellCost = r2(m.value * sellPct);
  const net = r2(m.value - m.debt - sellCost);
  const gain = r2(net - m.totalSpent);
  const breakeven = r2((m.totalSpent + m.debt) / (1 - sellPct));
  const sale = card('Análise de venda', `<div class="fields"><div class="f"><label>Preço de venda previsto</label>${inp('250 000,00', 'style="text-align:right"')}</div><div class="f"><label>Custos de venda (%)</label>${inp('5,0', 'style="text-align:right"')}</div></div>
    ${kv([['Preço de venda', eur(m.value)], ['− Dívida em aberto', eur(m.debt)], [`− Custos de venda (${num(m.sellCostPct, 1)}%)`, eur(sellCost)], ['<b>= Recebido líquido</b>', `<b>${eur(net)}</b>`], ['− Total gasto até hoje', eur(m.totalSpent)], ['<b>= Ganho / perda</b>', `<b class="${gain >= 0 ? 'pos' : 'neg'}">${eurS(gain)}</b>`]])}
    <div class="note"><b>Preço de equilíbrio: ${eur(breakeven)}</b> — abaixo disto vender significa perder dinheiro depois de pagar a dívida e os custos de venda. Capital próprio sem custos de venda: ${eur(m.equity)}.</div>
    <span class="eyebrow">E se vendesses por…</span>
    <div class="tbl-wrap"><table><thead><tr><th>Preço</th><th class="num">Recebido líquido</th><th class="num">Ganho / perda</th></tr></thead><tbody>${[200000, 225000, 250000, 275000].map((p) => { const n = r2(p - m.debt - p * sellPct); const g = r2(n - m.totalSpent); return `<tr><td>${eur(p)}</td><td class="num">${eur(n)}</td><td class="num ${g >= 0 ? 'pos' : 'neg'}">${eurS(g)}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="blist"><div class="r"><span class="n">Total gasto até hoje</span><span class="v">${eur(m.totalSpent)}</span><div class="bar"><i style="width:100%;background:var(--grad-warm)"></i></div></div></div>
    <div class="toolbar" style="font-size:12px;color:var(--fg-2)"><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:#6C5CFF"></i>Entrada ${eur(m.down)}</span><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${C.capital}"></i>Capital ${eur(m.capitalPaid)}</span><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${C.teal}"></i>Obras ${eur(m.worksPaid)}</span><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${C.interest}"></i>Custo do crédito ${eur(m.costCredit)}</span></div>`, { cls: 'c6', sub: 'Quanto ficaria no bolso se vendesses hoje.' });

  // simulator
  const bal = m.debt, r0 = m.rate / 100, N0 = m.remaining;
  const eur1 = 1.9, spread = 0.5;
  const rSim = (eur1 + spread) / 100;
  const nSim = 240;
  const p0 = pmt(bal, r0, N0), p1 = pmt(bal, rSim, nSim);
  const i0 = m.interestRemaining, i1 = r2(p1 * nSim - bal);
  const sens = [1.9, 2.9, 3.9].map((e) => [e, pmt(bal, (e + spread) / 100, N0)]);
  const sim = card('Simulador', `<div class="fields"><div class="f"><label>${m.index} (%)</label>${inp('1,90', 'style="text-align:right"')}<span class="hint">Spread ${pct(m.spread)} → taxa ${pct(eur1 + spread)}</span></div><div class="f"><label>Amortização antecipada (€)</label>${inp('0,00', 'style="text-align:right"')}</div><div class="f"><label>Terminar em (anos)</label>${inp('20', 'style="text-align:right"')}<span class="hint">Fim em ${my(addMonths('2026-10', nSim - 1))}</span></div><div class="f"><label>Efeito</label>${select(['Reduzir prazo', 'Reduzir prestação'], 'Reduzir prazo')}</div></div>
    <div class="compare"><div class="h">&nbsp;</div><div class="h v">Atual</div><div class="h v pro">Simulado</div>
      <div>Prestação (capital + juros)</div><div class="v">${eur(p0)}</div><div class="v pro">${eur(p1)}</div>
      <div>Fim do crédito</div><div class="v">${my(m.endYM)}</div><div class="v pro">${my(addMonths('2026-10', nSim - 1))}</div>
      <div>Juros ainda a pagar</div><div class="v">${eur(i0)}</div><div class="v pro">${eur(i1)}</div>
      <div><b>Esforço extra por mês</b></div><div class="v">—</div><div class="v pro pos">${eurS(p1 - p0)}</div>
      <div><b>Poupança em juros</b></div><div class="v">—</div><div class="v pro pos">${eurS(i0 - i1)}</div></div>
    <span class="eyebrow">E se a ${m.index} subir?</span>
    <div class="tbl-wrap"><table><thead><tr><th>${m.index}</th><th class="num">Taxa</th><th class="num">Prestação</th><th class="num">Diferença</th></tr></thead><tbody>${sens.map(([e, p]) => `<tr><td>${pct(e)}</td><td class="num">${pct(e + spread)}</td><td class="num">${eur(p)}</td><td class="num ${p - p0 > 0.5 ? 'neg' : ''}">${Math.abs(p - p0) < 0.5 ? '—' : eurS(p - p0)}</td></tr>`).join('')}</tbody></table></div>`, { cls: 'c6', sub: 'Quanto custa acabar o crédito mais cedo ou se os juros mudarem. Não altera os teus dados.', actions: btn('Guardar como cenário', { sm: true, icon: 'plus' }) });

  // pace + milestones
  const ideal = r2((m.principal * m.paidCount) / 240);
  const behind = r2(ideal - m.capitalPaid);
  const pace = card('Ritmo para o objetivo de 20 anos', `<div class="strip" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div class="it"><span class="eyebrow">Média por mês (objetivo)</span><b class="num">${eur(m.principal / 240)}</b></div><div class="it"><span class="eyebrow">Média paga por mês</span><b class="num">${eur(m.capitalPaid / m.paidCount)}</b></div><div class="it"><span class="eyebrow">Capital ideal pago</span><b class="num">${eur(ideal)}</b></div><div class="it"><span class="eyebrow">Diferença</span><b class="num neg">−${eur(behind)}</b></div></div>
    <div class="deltaline">${chip('Abaixo do ritmo', 'warn')}<span class="card-sub">${m.paidCount} prestações pagas de 240 previstas no objetivo</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Marco</th><th class="num">Em falta (FINE)</th><th class="num">Devia faltar</th><th class="num">Diferença</th><th class="num">Poupar / mês</th></tr></thead><tbody>
      <tr><td>08/2028 <small>(8 anos)</small></td><td class="num">${eur(83857.17)}</td><td class="num">${eur(66960)}</td><td class="num neg">${eur(16897.17)}</td><td class="num">${eur(16897.17 / 22)}</td></tr>
      <tr><td>08/2031 <small>(11 anos)</small></td><td class="num">${eur(79691.62)}</td><td class="num">${eur(50220)}</td><td class="num neg">${eur(29471.62)}</td><td class="num">${eur(29471.62 / 58)}</td></tr></tbody></table></div>
    <span class="card-sub">“Em falta (FINE)” vem da simulação do banco na Ficha de Informação Normalizada Europeia; “Devia faltar” é o plano linear a 20 anos.</span>`, { cls: 'c7' });

  // inflation (compounded)
  const years = m.inflation.filter(([y]) => y >= 2021);
  let idx = 1; const inflRows = years.map(([y, p]) => { idx *= 1 + p / 100; return [y, p, idx]; });
  const simple = sum(years, ([, p]) => p) / 100;
  const adj = r2(m.price * idx);
  const infl = card('Inflação', `<div class="tbl-wrap"><table><thead><tr><th>Ano</th><th class="num">IPC</th><th class="num">Índice acumulado</th></tr></thead><tbody>${inflRows.map(([y, p, i]) => `<tr><td>${y}</td><td class="num">${pct(p)}</td><td class="num">${num(i, 4)}</td></tr>`).join('')}</tbody></table></div>
    ${kv([['Preço de compra (2020)', eur(m.price)], ['A preços de 2025', `<b>${eur(adj)}</b>`], ['Valorização nominal', `${num(((m.value / m.price) - 1) * 100, 1)}%`], ['Valorização real', `<b class="pos">${num(((m.value / adj) - 1) * 100, 1)}%</b>`]])}
    <div class="note">As taxas anuais são <b>compostas</b> (${num((idx - 1) * 100, 1)}% acumulado), não somadas (${num(simple * 100, 1)}%).</div>`, { cls: 'c5', sub: 'Quanto vale hoje o preço que pagaste em 2020.', actions: btn('Editar IPC', { sm: true, icon: 'edit' }) });
  const content = `${propHeader(m, 4, false)}<div class="grid">${sale}${sim}${pace}${infl}</div>`;
  return page('imovel', m.name, content, { property: m.name });
}

/* ================= Free: dialog over page + settings ================= */
const proBenefits = (items) => items.map((t) => `<div class="benefit"><span class="tick">${ico('check')}</span><span>${t}</span></div>`).join('');
function dialogPro({ feature = 'real_estate', member = false } = {}) {
  const lead = {
    real_estate: 'O <b>Imobiliário e empréstimos</b> faz parte do plano Pro.',
    simulator: 'O <b>simulador de crédito</b> faz parte do plano Pro.',
    members: 'Convidar outras pessoas para o agregado faz parte do plano Pro.',
  }[feature];
  const benefits = proBenefits([
    '<b>Imobiliário e empréstimos</b>: imóveis, plano de prestações, amortizações, obras e simulador',
    '<b>Contas e portfolios sem limite</b> (no Free: 3 contas e 2 portfolios)',
    '<b>Convidar pessoas do agregado</b>, cada uma com a sua conta e função',
    '<b>Importação de extratos com IA</b> para bancos novos',
  ]);
  const body = `<div style="display:flex;gap:14px;align-items:center"><span class="hero-pro">${ico('spark')}</span><div><b style="font-size:16px">${member ? 'Só o proprietário pode ativar o Pro' : 'Ativa o modo Pro'}</b><div class="fg2" style="font-size:13px;margin-top:2px">${member ? 'O plano pertence ao agregado <b>Família Rocha</b> e é gerido por <b>Rui</b>.' : lead}</div></div></div>
    ${member ? `<div class="note">Pede ao proprietário para ativar o Pro. Assim que o fizer, passas a ter acesso completo sem mais nada a fazer.</div>` : `<div style="display:flex;flex-direction:column;gap:10px">${benefits}</div>`}
    <div class="note">${member ? 'Entretanto podes continuar a explorar esta página com dados de exemplo.' : 'O plano é do agregado: ao ativares o Pro, todos os membros passam a beneficiar. Se voltares ao Free, <b>nenhum dado é apagado</b>; o que ultrapassar os limites fica só de leitura.'}</div>`;
  const footer = member ? `${btn('Fechar', { ghost: true })}${btn('Avisar o proprietário', { primary: true })}` : `${btn('Agora não', { ghost: true })}${btn('Ativar Pro', { primary: true, icon: 'spark' })}`;
  return modalShell({ title: 'Plano Pro', body, footer, icon: '<span class="pro-chip">PRO</span>' });
}
function dialogLimit() {
  const body = `<div style="display:flex;gap:14px;align-items:center"><span class="hero-pro" style="background:var(--grad-warm)">${ico('lock')}</span><div><b style="font-size:16px">Limite do plano Free atingido</b><div class="fg2" style="font-size:13px;margin-top:2px">Já tens <b>3 de 3 contas</b>. Para adicionar mais contas ativa o Pro.</div></div></div>
    <div class="meters"><div class="meter-row"><span class="l">Contas</span><span class="v num">3 / 3</span><span class="m">Free</span><div class="bar thick warm"><i style="width:100%"></i></div></div></div>
    <div class="note">As tuas contas e movimentos continuam disponíveis. Só ficam bloqueadas <b>novas</b> contas até ativares o Pro ou removeres uma.</div>`;
  return modalShell({ title: 'Plano Free', body, footer: `${btn('Cancelar', { ghost: true })}${btn('Ativar Pro', { primary: true, icon: 'spark' })}` });
}

/* settings tabs */
const SET_TABS = ['Agregado e parâmetros', 'Plano e subscrição', 'Utilizadores e convites'];
function definicoesPlano() {
  const meter = (l, v, max, pro) => `<div class="meter-row"><span class="l">${l}</span><span class="v num">${v}${max ? ` / ${max}` : ''}</span><span class="m">${pro ? 'só Pro' : max ? 'Free' : ''}</span><div class="bar thick ${max && v >= max ? 'warm' : ''}"><i style="width:${max ? Math.min((v / max) * 100, 100) : 0}%"></i></div></div>`;
  const row = (f, a, b) => `<div>${f}</div><div class="v">${a}</div><div class="v pro">${b}</div>`;
  const cmp = `<div class="compare" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr)"><div class="h">Funcionalidade</div><div class="h v">Free</div><div class="h v pro">Pro</div>
    ${row('Contas', '3', 'Sem limite')}${row('Portfolios', '2', 'Sem limite')}${row('Utilizadores do agregado', '1 (proprietário)', 'Sem limite, com convites')}${row('Pessoas sem conta (titulares)', 'Sim', 'Sim')}
    ${row('Despesas, orçamentos e objetivos', 'Sim', 'Sim')}${row('Importação de extratos (ficheiros)', 'Sim', 'Sim')}${row('Importação com IA para bancos novos', '—', 'Sim')}
    ${row('Imobiliário e empréstimos', chip('Pré-visualização'), 'Completo')}${row('Simulador e análise de venda', chip('Pré-visualização'), 'Completo')}</div>`;
  const content = `${pagebar('O plano pertence ao agregado e só o proprietário o pode alterar.')}${tabs(SET_TABS, 1)}<div class="grid">
    <div class="card c5"><div class="card-h"><h3>O teu plano</h3>${chip('Atual')}</div><div style="display:flex;gap:14px;align-items:center"><span class="type-ico" style="width:52px;height:52px;border-radius:14px;background:var(--panel-2);color:var(--fg-2)">${ico('bank')}</span><div><div class="big" style="font-size:26px;font-weight:800">Free</div><span class="card-sub">Agregado Família Rocha · proprietário Rui</span></div></div>
      <div class="note">Sem custos. Limite de 3 contas, 2 portfolios e 1 utilizador; o Imobiliário e empréstimos abre em modo de pré-visualização.</div><div class="toolbar">${btn('Ativar Pro', { primary: true, icon: 'spark' })}<span class="card-sub">Sem compromisso · podes voltar ao Free</span></div></div>
    <div class="card c7"><div class="card-h"><h3>Utilização</h3><span class="card-sub">estado atual do agregado</span></div><div class="meters">${meter('Contas', 3, 3)}${meter('Portfolios', 2, 2)}${meter('Utilizadores', 1, 1)}${meter('Imóveis', 0, 0, true)}</div><span class="card-sub">Nos limites, novos itens pedem para ativar o Pro; o que já existe nunca é apagado.</span></div>
    ${card('Comparar planos', cmp, { cls: 'c12', sub: 'Pro desbloqueia limites e módulos; os dados do agregado ficam sempre contigo.' })}</div>`;
  return page('definicoes', 'Definições', content, { free: true });
}
function definicoesUtilizadores() {
  const role = (r, a, b, c, d) => `<tr><td>${r}</td>${[a, b, c, d].map((x) => `<td style="text-align:center">${x ? `<span class="pos">${ico('check')}</span>` : '<span class="muted">—</span>'}</td>`).join('')}</tr>`;
  const content = `${pagebar('Convida as pessoas do agregado e escolhe o que cada uma pode fazer.')}${tabs(SET_TABS, 2)}<div class="grid">
    <div class="card c7"><div class="card-h"><h3>Utilizadores com conta</h3>${btn('Convidar utilizador', { sm: true, icon: 'plus', primary: true, lock: true })}</div>
      <div style="display:flex;align-items:center;gap:10px">${L.avatar('Rui', '#F2913D')}<span style="flex:1;min-width:0">Rui <span class="chip accent">Tu</span><br><span class="card-sub">rui@exemplo.pt</span></span>${chip('Proprietário', 'accent')}</div>
      <div class="empty" style="gap:var(--s2)"><span class="pro-chip">PRO</span><b>Convida o resto da família</b><span>No plano Free só o proprietário tem acesso. Com o Pro, cada pessoa entra com a sua conta e a função que escolheres.</span>${btn('Convidar utilizador', { primary: true, icon: 'plus', lock: true })}</div>
      <span class="card-sub">As pessoas sem conta (ex.: crianças) continuam disponíveis como titulares de contas e portfolios.</span></div>
    <div class="card c5"><div class="card-h"><h3>Funções</h3>${chip('Pré-visualização', 'demo')}</div><div class="tbl-wrap"><table><thead><tr><th>Permissão</th><th style="text-align:center">Prop.</th><th style="text-align:center">Admin</th><th style="text-align:center">Membro</th><th style="text-align:center">Leitor</th></tr></thead><tbody>
      ${role('Ver todos os dados', 1, 1, 1, 1)}${role('Criar e editar movimentos', 1, 1, 1, 0)}${role('Importar extratos', 1, 1, 1, 0)}${role('Gerir contas e portfolios', 1, 1, 0, 0)}${role('Convidar e remover membros', 1, 1, 0, 0)}${role('Eliminar ou exportar o agregado', 1, 0, 0, 0)}</tbody></table></div><span class="card-sub">A função define o que cada utilizador pode fazer; os limites do plano aplicam-se a todos.</span></div>
    <div class="card c12"><div class="card-h"><h3>Pessoas do agregado (titulares)</h3>${btn('Pessoa', { sm: true, icon: 'plus' })}</div><div class="blist">${L.PEOPLE.map(([n, c]) => `<div style="display:flex;align-items:center;gap:10px">${L.avatar(n, c)}<span style="flex:1">${n}</span><span class="muted">${n === 'Rui' ? 'Utilizador · ' : ''}${n === 'Rui' || n === 'Ana' ? '6' : '3'} contas</span></div>`).join('')}</div></div></div>`;
  return page('definicoes', 'Definições', content, { free: true });
}

/* ================= Pro-only modals ================= */
const people = `<div class="f full"><label>Titulares</label><div class="toolbar" style="gap:16px"><label class="check"><input type="checkbox" checked> ${L.avatar('Rui', '#F2913D')} Rui ${inp('50', 'style="width:64px;text-align:right"')}%</label><label class="check"><input type="checkbox" checked> ${L.avatar('Ana', '#9D6BFF')} Ana ${inp('50', 'style="width:64px;text-align:right"')}%</label><label class="check"><input type="checkbox"> ${L.avatar('Liliana', '#3CCB7F')} Liliana</label></div><span class="hint">A soma das percentagens tem de ser 100%.</span></div>`;
const mNewProperty = () => modalShell({ title: 'Novo imóvel', wide: true, body: `<div class="fields">
  ${field('Nome', inp('Apartamento T3'))}${field('Tipo', select(['Casa de morada', 'Habitação secundária', 'Arrendamento', 'Terreno', 'Garagem'], 'Casa de morada'))}
  ${field('Morada (opcional)', inp('', 'placeholder="Rua, localidade"'), '', true)}
  ${field('Data de compra', inp('28/08/2020'))}${field('Preço de compra (€)', inp('124 000,00', 'style="text-align:right"'))}
  ${field('Entrada (€)', inp('12 400,00', 'style="text-align:right"'))}${field('Custos de venda previstos (%)', inp('5,0', 'style="text-align:right"'), 'Usado na análise de venda.')}
  ${people}
  <div class="f full"><label>Custos de aquisição</label><div class="fields" style="grid-template-columns:repeat(4,minmax(0,1fr))"><div class="f"><span class="hint">Escritura</span>${inp('915,00', 'style="text-align:right"')}</div><div class="f"><span class="hint">IMT</span>${inp('631,86', 'style="text-align:right"')}</div><div class="f"><span class="hint">Imposto de selo</span>${inp('992,00', 'style="text-align:right"')}</div><div class="f"><span class="hint">Despesas bancárias</span>${inp('20,85', 'style="text-align:right"')}</div></div><span class="hint">Total 2 559,71 €. Entram no total investido.</span></div>
  ${field('Avaliação atual (€)', inp('250 000,00', 'style="text-align:right"'))}${field('Fonte da avaliação', select(['Estimativa manual', 'Avaliação bancária', 'Outra'], 'Estimativa manual'))}
  <label class="check f full"><input type="checkbox" checked> Incluir no património líquido</label></div>`, footer: `${btn('Cancelar', { ghost: true })}${btn('Guardar imóvel', { primary: true })}` });

const mNewLoan = () => modalShell({ title: 'Novo empréstimo', wide: true, body: `<div class="fields">
  ${field('Tipo', select(['Crédito habitação', 'Crédito automóvel', 'Crédito pessoal'], 'Crédito habitação'))}${field('Imóvel associado', select(['Apartamento T3', 'Nenhum'], 'Apartamento T3'))}
  ${field('Capital (€)', inp('111 600,00', 'style="text-align:right"'))}${field('Primeira prestação', inp('01/09/2020'))}
  ${field('Prazo (meses)', inp('480', 'style="text-align:right"'))}${field('Dia de pagamento', inp('1', 'style="text-align:right"'))}
  <div class="f full"><label>Tipo de taxa</label><div class="seg" style="align-self:flex-start"><button aria-pressed="false">Fixa</button><button aria-pressed="true">Variável</button><button aria-pressed="false">Mista</button></div></div>
  ${field('Indexante', select(['Euribor 3M', 'Euribor 6M', 'Euribor 12M'], 'Euribor 6M'))}${field('Spread (%)', inp('0,50', 'style="text-align:right"'))}
  ${field('Revisão a cada (meses)', inp('6', 'style="text-align:right"'), 'Março e setembro.')}${field('TAEG (%)', inp('', 'placeholder="Da FINE"'), 'Opcional.')}
  ${field('Conta de débito', select(['Conta à ordem · Banco A · Rui'], 'Conta à ordem · Banco A · Rui'), '', true)}
  <div class="f full"><label>Seguros mensais (opcional)</label><div class="fields" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="f"><span class="hint">Vida</span>${inp('12,39', 'style="text-align:right"')}</div><div class="f"><span class="hint">Casa</span>${inp('18,76', 'style="text-align:right"')}</div><div class="f"><span class="hint">Crédito</span>${inp('36,02', 'style="text-align:right"')}</div></div></div></div>
  <div class="note">A app gera o plano de prestações (amortização francesa). Depois confirmas ou corriges as prestações reais, ou importas o histórico da tua folha de cálculo.</div>`, footer: `${btn('Cancelar', { ghost: true })}${btn('Guardar e gerar plano', { primary: true })}` });

const mLoanEvent = () => modalShell({ title: 'Evento do empréstimo', body: `<div class="seg" style="align-self:flex-start"><button aria-pressed="true">Amortização antecipada</button><button aria-pressed="false">Revisão da taxa</button><button aria-pressed="false">Renegociação</button></div>
  <div class="fields">${field('Data', inp('01/02/2023'))}${field('Valor amortizado (€)', inp('15 000,00', 'style="text-align:right"'))}${field('Comissão (€)', inp('0,00', 'style="text-align:right"'))}${field('Efeito', select(['Reduzir prestação', 'Reduzir prazo'], 'Reduzir prestação'))}${field('Débito da conta', select(['Conta à ordem · Banco A · Rui'], 'Conta à ordem · Banco A · Rui'), 'Cria o movimento ligado a este evento.', true)}</div>
  <div class="note"><b>Efeito previsto</b><br>Dívida: 105 819,55 € → 90 819,55 €<br>Prestação: 340,53 € → 291,40 € · Prazo: sem alteração · Juros poupados (estimativa): 9 430,00 €</div>
  <span class="card-sub">As prestações seguintes são recalculadas; as já pagas não mudam.</span>`, footer: `${btn('Cancelar', { ghost: true })}${btn('Guardar evento', { primary: true })}` });

const mNewWorks = () => modalShell({ title: 'Nova obra', wide: true, body: `<div class="fields">
  ${field('Nome', inp('Cozinha'))}${field('Fornecedor', inp('Decozim'))}${field('Descrição', inp('Armários novos'), '', true)}
  ${field('Orçamento (€)', inp('9 166,00', 'style="text-align:right"'))}${field('Entrada (%)', inp('0', 'style="text-align:right"'))}
  ${field('Estado', select(['Planeada', 'Em curso', 'Concluída'], 'Concluída'))}${field('Fim previsto', inp('21/07/2026'))}
  <div class="f full"><label>Fases de pagamento</label><div class="tbl-wrap" style="margin:0"><table><thead><tr><th>Descrição</th><th class="num">Valor</th><th>Prevista</th><th>Paga em</th><th></th></tr></thead><tbody>
  ${[['Adjudicação e envio para produção', '4 900,00', '14/05/2026', '14/05/2026'], ['Entrega do mobiliário', '2 460,00', '26/06/2026', '29/06/2026'], ['Medição dos cerâmicos', '1 230,00', '26/06/2026', '09/07/2026'], ['Conclusão da montagem', '576,00', '21/07/2026', '21/07/2026']].map(([a, b, c, d]) => `<tr><td>${a}</td><td class="num">${b} €</td><td>${c}</td><td>${d}</td><td><button class="btn ghost icon sm danger">${ico('trash')}</button></td></tr>`).join('')}</tbody></table></div>
  <div class="toolbar" style="justify-content:space-between">${btn('Fase', { sm: true, icon: 'plus' })}<span class="chip pos">${ico('check')}As fases somam 9 166,00 € = orçamento</span></div></div>
  ${field('Notas', inp('Desconto no valor final de 123 €'), '', true)}</div>`, footer: `${btn('Cancelar', { ghost: true })}${btn('Guardar obra', { primary: true })}` });

const mImport = () => modalShell({ title: 'Importar folha de cálculo', wide: true, body: `<div class="banner" style="margin:0"><p style="min-width:0"><b>Credito_Habitacao_Com_Obras.xlsx</b> <span class="muted">· 204 KB · 8 folhas</span></p>${chip('Detetado automaticamente · 100%', 'pos')}</div>
  <div class="tbl-wrap" style="margin:0"><table><thead><tr><th>Folha</th><th>O que vai ser importado</th><th class="num">Linhas</th><th>Ação</th></tr></thead><tbody>
  <tr><td><b>Sumário</b></td><td>Prestações (capital, juros, comissões, imposto, seguros)</td><td class="num">73</td><td>${chip('Importar', 'accent')}</td></tr>
  <tr><td><b>Amortização</b></td><td>Amortizações antecipadas (15 000 € · 01/02/2023)</td><td class="num">1</td><td>${chip('Importar', 'accent')}</td></tr>
  <tr><td><b>Remodelações</b></td><td>Obras: orçamento, fornecedor, entrada, estado</td><td class="num">4</td><td>${chip('Importar', 'accent')}</td></tr>
  <tr><td><b>Pagamentos</b></td><td>Fases de pagamento das obras</td><td class="num">8</td><td>${chip('Importar', 'accent')}</td></tr>
  <tr><td><b>Inflação</b></td><td>IPC anual 2020–2025</td><td class="num">6</td><td>${chip('Importar', 'accent')}</td></tr>
  <tr><td><b>Resumo · Pago por anos · Plano de pagamento</b></td><td class="fg2">Calculados pela app a partir das prestações</td><td class="num">—</td><td>${chip('Recalculado')}</td></tr></tbody></table></div>
  <div class="note"><b>Antes de importar:</b> o seguro de crédito (225,38 €) não entra nos totais da folha e passa a contar no custo do crédito. A inflação passa a ser composta em vez de somada.</div>
  <label class="check"><input type="checkbox" checked> Atualizar prestações existentes sem duplicar</label>
  <span class="card-sub">Notas e ligações a movimentos bancários nunca são substituídas por uma importação.</span>`, footer: `${btn('Cancelar', { ghost: true })}${btn('Importar 92 linhas', { primary: true, icon: 'down' })}` });

module.exports = { imobiliarioLista, imovelResumo, imovelPrestacoes, imovelEventos, imovelObras, imovelVenda, definicoesPlano, definicoesUtilizadores, dialogPro, dialogLimit, mNewProperty, mNewLoan, mLoanEvent, mNewWorks, mImport, pro, demo };
