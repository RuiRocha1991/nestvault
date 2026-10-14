/* Authentication, invites, pool choice, members and account mockups (FR — Pools, members and user account).
   UI text is pt-PT. Sign-up is closed by default (ALLOW_SIGNUP=false) and open only through an invite. */
const L = require('./lib.cjs');
const { ico, btn, card, pagebar, tabs, page, modalShell, field, inp, select, avatar, PEOPLE } = L;

const chip = (t, cls = '') => `<span class="chip ${cls}">${t}</span>`;
const brand = '<div class="brand"><b>COFRE</b><span>FINANÇAS FAMILIARES</span></div>';
const logoutBtn = '';

/* ---------- shell ---------- */
const deco = `<div class="auth-deco"><small>Património líquido</small><b class="num">48 210,35 €</b>
  <svg viewBox="0 0 260 60" width="100%" height="56"><defs><linearGradient id="dg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <path d="M0,48 C30,44 40,36 70,38 S120,22 150,26 S210,10 260,6 V60 H0Z" fill="url(#dg)"/><path d="M0,48 C30,44 40,36 70,38 S120,22 150,26 S210,10 260,6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg></div>`;
const brandPanel = `<aside class="auth-brand">${brand}${deco}
  <h2>As finanças da família, num só cofre.</h2>
  <p>Contas, investimentos, despesas e imobiliário partilhados pelo agregado, cada pessoa com a sua própria conta.</p>
  <ul><li>${ico('check')}Dados isolados por agregado</li><li>${ico('check')}A sessão mantém-se, sem voltar a entrar a cada visita</li><li>${ico('check')}Tu decides quem vê e quem pode alterar</li></ul></aside>`;
const authPage = (card, foot = '') => `<div class="auth">${brandPanel}<div class="auth-top">${brand}</div><main class="auth-main">${card}${foot ? `<div class="auth-foot">${foot}</div>` : ''}</main></div>`;

const pw = (label, { val = '', err = false, hint = '', link = '', ph = '', id } = {}) =>
  `<div class="f"><div class="fr"><label>${label}</label>${link}</div><div class="iw has-l">${ico('key', 'ico l')}<input class="input ${err ? 'err' : ''}" type="password" value="${val}" placeholder="${ph}"><span class="eye">${ico('eye')}</span></div>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
const em = (label, val = '', { err = false, dis = false, ph = 'nome@exemplo.pt', hint = '' } = {}) =>
  `<div class="f"><label>${label}</label><div class="iw has-l">${ico('mail', 'ico l')}<input class="input ${err ? 'err' : ''} ${dis ? 'dis' : ''}" value="${val}" placeholder="${ph}" ${dis ? 'disabled' : ''}></div>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
const txt = (label, val = '', ph = '') => `<div class="f"><label>${label}</label><div class="iw has-l">${ico('user', 'ico l')}<input class="input" value="${val}" placeholder="${ph}"></div></div>`;
const meter = (n, label, color) => `<div class="meter-pw">${[1, 2, 3, 4].map((i) => `<i style="${i <= n ? `background:${color}` : ''}"></i>`).join('')}</div><span class="hint" style="color:${color}">${label}</span>`;
const reqs = (a, b, c) => `<div class="reqs">${[['Pelo menos 12 caracteres', a], ['Não é uma palavra-passe comum', b], ['Diferente do teu email', c]].map(([t, ok]) => `<div class="${ok ? 'ok' : 'no'}">${ico(ok ? 'check' : 'x')}${t}</div>`).join('')}</div>`;
const alert = (kind, icon, html) => `<div class="alert ${kind}" role="alert">${ico(icon)}<div>${html}</div></div>`;
const cardBox = (inner) => `<div class="auth-card">${inner}</div>`;
const submit = (label, { disabled = false, icon } = {}) => `<button class="btn primary lg" ${disabled ? 'disabled' : ''}>${icon ? ico(icon) : ''}${label}</button>`;

/* ---------- 47–49 login ---------- */
const login = ({ error = false, locked = false } = {}) => authPage(cardBox(`
  <div><h1>Entrar</h1></div><p class="lead">Bem-vindo de volta ao teu cofre familiar.</p>
  ${error ? alert('err', 'alert', '<b>Email ou palavra-passe incorretos.</b><br><span class="fg2">Confirma os dados e tenta novamente.</span>') : ''}
  ${locked ? alert('warn', 'clock', '<b>Demasiadas tentativas.</b><br><span class="fg2">Por segurança, o acesso a esta conta está pausado. Tenta novamente dentro de <b class="num">14:32</b>.</span>') : ''}
  <form>${em('Email', 'rui@exemplo.pt', { err: error })}${pw('Palavra-passe', { val: '••••••••••••', err: error, link: '<a class="link" style="font-size:12px">Esqueci-me da palavra-passe</a>' })}
  ${submit(locked ? 'Tenta novamente em 14:32' : 'Entrar', { disabled: locked })}</form>
  <span class="card-sub" style="text-align:center">A sessão mantém-se durante 30 dias de atividade neste dispositivo.</span>`),
  'Ainda não tens conta? O registo é por convite: pede ao proprietário do agregado ou abre a ligação que recebeste por email.');

/* ---------- 50–51 registar ---------- */
const registar = () => authPage(cardBox(`
  <h1>Criar conta</h1><p class="lead">Cria a tua conta pessoal. Depois escolhes ou crias um agregado.</p>
  <form>${txt('Nome', 'Ana Rocha')}${em('Email', 'ana@exemplo.pt')}
  <div class="f">${''}<label>Palavra-passe</label><div class="iw has-l">${ico('key', 'ico l')}<input class="input" type="password" value="••••••••••••••••"><span class="eye">${ico('eye')}</span></div>${meter(3, 'Boa · usa uma frase longa para ficar ainda mais forte', 'var(--warn)')}${reqs(true, true, true)}</div>
  ${pw('Confirmar palavra-passe', { val: '••••••••••••••••' })}
  ${submit('Criar conta')}</form>
  <span class="card-sub" style="text-align:center">Vais receber um email para confirmar o endereço.</span>`),
  'Já tens conta? <a>Entrar</a>');

const registarFechado = () => authPage(cardBox(`
  <span class="big-ico" style="background:var(--accent-soft);color:var(--accent-2)">${ico('lock')}</span>
  <h1>O registo está fechado</h1><p class="lead" style="margin-top:-6px">Esta instalação só aceita novas pessoas por convite.</p>
  <div class="note">Pede ao proprietário do agregado para te convidar. Vais receber um email com uma ligação de uso único, válida durante 7 dias.</div>
  ${btn('Voltar a entrar', { primary: true }).replace('btn primary', 'btn primary lg')}`), 'Já tens um convite? Abre a ligação que recebeste por email.');

/* ---------- 52–55 password reset ---------- */
const recuperar = () => authPage(cardBox(`
  <h1>Recuperar palavra-passe</h1><p class="lead">Indica o email da tua conta e enviamos uma ligação para criares uma nova palavra-passe.</p>
  <form>${em('Email', 'ana@exemplo.pt')}${submit('Enviar ligação')}</form><a class="link" style="text-align:center;font-size:13px">← Voltar a entrar</a>`));
const recuperarEnviado = () => authPage(cardBox(`
  <span class="big-ico" style="background:rgba(60,203,127,.15);color:var(--pos)">${ico('mail')}</span>
  <h1>Verifica o teu email</h1><p class="lead" style="margin-top:-6px">Se existir uma conta para <b>ana@exemplo.pt</b>, enviámos uma ligação para criares uma nova palavra-passe. A ligação é de uso único e expira em pouco tempo.</p>
  <div class="note">Não aparece? Procura na pasta de spam. Por segurança, esta mensagem é igual quer a conta exista quer não.</div>
  ${btn('Voltar a entrar', { primary: true }).replace('btn primary', 'btn primary lg')}<span class="card-sub" style="text-align:center">Não recebeste? <a class="link">Reenviar</a> <span class="muted">(disponível em 0:45)</span></span>`));
const recuperarNova = () => authPage(cardBox(`
  <h1>Nova palavra-passe</h1><p class="lead">Escolhe uma palavra-passe que não uses em mais lado nenhum.</p>
  <form><div class="f"><label>Nova palavra-passe</label><div class="iw has-l">${ico('key', 'ico l')}<input class="input" type="password" value="••••••••••••••••••"><span class="eye">${ico('eye')}</span></div>${meter(4, 'Forte', 'var(--pos)')}${reqs(true, true, true)}</div>
  ${pw('Confirmar palavra-passe', { val: '••••••••••••••••••' })}${submit('Guardar palavra-passe')}</form>
  ${alert('info', 'info', 'Ao guardar, terminamos a sessão em todos os outros dispositivos.')}`));
const recuperarInvalido = () => authPage(cardBox(`
  <span class="big-ico" style="background:rgba(242,166,61,.15);color:var(--warn)">${ico('clock')}</span>
  <h1>Esta ligação já não é válida</h1><p class="lead" style="margin-top:-6px">Expirou ou já foi utilizada. As ligações de recuperação só podem ser usadas uma vez.</p>
  ${btn('Pedir nova ligação', { primary: true }).replace('btn primary', 'btn primary lg')}<a class="link" style="text-align:center;font-size:13px">← Voltar a entrar</a>`));

/* ---------- 56–57 email verification ---------- */
const verificarPendente = () => authPage(cardBox(`
  <span class="big-ico" style="background:var(--accent-soft);color:var(--accent-2)">${ico('mail')}</span>
  <h1>Confirma o teu email</h1><p class="lead" style="margin-top:-6px">Enviámos uma ligação de confirmação para <b>ana@exemplo.pt</b>. Abre-a para ativar a conta.</p>
  ${btn('Reenviar email', { icon: 'refresh' }).replace('class="btn ', 'class="btn lg ')}${btn('Alterar o email', { ghost: true }).replace('class="btn ', 'class="btn lg ')}
  <div class="note">Podes fechar esta página. Quando confirmares, continuas de onde ficaste.</div>`));
const verificarSucesso = () => authPage(cardBox(`
  <span class="big-ico" style="background:rgba(60,203,127,.15);color:var(--pos)">${ico('check')}</span>
  <h1>Email confirmado</h1><p class="lead" style="margin-top:-6px">A tua conta está ativa. Já podes escolher ou criar um agregado.</p>
  ${btn('Continuar', { primary: true }).replace('btn primary', 'btn primary lg')}`));

/* ---------- 58–61 invites ---------- */
const poolBox = `<div class="who-box"><span class="type-ico" style="background:#6C5CFF2e;color:#6C5CFF;width:40px;height:40px">${ico('users')}</span><div style="flex:1;min-width:0"><b>Família Rocha</b><br><span class="card-sub">Convidado por Rui</span></div>${chip('Membro', 'accent')}</div>`;
const conviteDetails = (email) => `${poolBox}<dl class="kv"><dt>Email do convite</dt><dd>${email}</dd><dt>Função</dt><dd>Membro: vê e edita movimentos e importa extratos</dd><dt>Válido até</dt><dd>19/10/2026</dd></dl>`;
const convitePublico = () => authPage(cardBox(`
  <h1>Foste convidado</h1><p class="lead" style="margin-top:-6px">Rui convidou-te para o agregado <b>Família Rocha</b>.</p>
  ${conviteDetails('liliana@exemplo.pt')}
  ${btn('Entrar para aceitar', { primary: true }).replace('btn primary', 'btn primary lg')}<div class="divider">ou</div>${btn('Criar conta com este email').replace('class="btn ', 'class="btn lg ')}
  <span class="card-sub" style="text-align:center">Só podes criar conta com o email para o qual o convite foi enviado.</span>`));
const conviteAceitar = () => authPage(cardBox(`
  <h1>Aceitar convite</h1><p class="lead" style="margin-top:-6px">Entraste como <b>liliana@exemplo.pt</b>, o email do convite.</p>
  ${conviteDetails('liliana@exemplo.pt')}
  ${btn('Aceitar convite', { primary: true, icon: 'check' }).replace('btn primary', 'btn primary lg')}${btn('Recusar', { ghost: true }).replace('class="btn ', 'class="btn lg ')}`));
const conviteDiferente = () => authPage(cardBox(`
  <h1>Este convite é para outro email</h1>
  ${alert('warn', 'alert', 'O convite foi enviado para <b>liliana@exemplo.pt</b>, mas entraste como <b>ana@exemplo.pt</b>.')}
  ${poolBox}
  ${btn('Terminar sessão e entrar com outro email', { primary: true, icon: 'logout' }).replace('btn primary', 'btn primary lg')}<span class="card-sub" style="text-align:center">Por segurança, um convite só pode ser aceite pelo email a que foi enviado.</span>`));
const conviteExpirado = () => authPage(cardBox(`
  <span class="big-ico" style="background:rgba(242,166,61,.15);color:var(--warn)">${ico('clock')}</span>
  <h1>Este convite expirou</h1><p class="lead" style="margin-top:-6px">Os convites são de uso único e valem 7 dias. Pede a Rui um novo convite para o agregado <b>Família Rocha</b>.</p>
  ${btn('Voltar a entrar', { primary: true }).replace('btn primary', 'btn primary lg')}`));

/* ---------- 62–63 choose / create pool ---------- */
const poolTop = `<div class="pool-top">${brand}<span style="flex:1"></span><div class="who"><span class="avatars">${avatar('Rui', '#F2913D')}</span><span class="nm">Rui</span></div>${btn('Terminar sessão', { ghost: true, sm: true, icon: 'logout' })}</div>`;
const poolsShell = (inner) => `<div class="auth" style="grid-template-columns:minmax(0,1fr)"><main style="display:flex;flex-direction:column;background:var(--bg)">${poolTop}<div style="width:min(860px,100%);margin:0 auto;padding:16px 32px 48px;display:flex;flex-direction:column;gap:20px">${inner}</div></main></div>`;
const poolCard = (name, role, plan, people, last, color, { pro = false } = {}) => `<div class="card pool-card"><div class="card-h"><span class="type-ico" style="background:${color}2e;color:${color}">${ico('users')}</span><div style="display:flex;flex-direction:column;min-width:0"><h3 style="margin:0">${name}</h3><span class="card-sub">${people}</span></div></div>
  <div class="toolbar">${chip(role, role === 'Proprietário' ? 'accent' : '')}${chip(plan, pro ? 'accent' : '')}<span class="grow"></span><span class="card-sub">${last}</span></div>${btn('Abrir', { primary: true })}</div>`;
const pools = () => poolsShell(`
  <div><h1 style="font-size:var(--fs-2xl);font-weight:700;margin:0">Escolhe um agregado</h1><p class="card-sub" style="margin:6px 0 0">Tens acesso a 2 agregados. Os dados de cada um são totalmente separados.</p></div>
  <div class="banner" style="margin:0">${ico('mail')}<p><b>Tens 1 convite pendente</b> de Ana para o agregado <b>Casa da Praia</b> (função Leitor).</p>${btn('Ver convite')}</div>
  <div class="goal-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${poolCard('Família Rocha', 'Proprietário', 'Pro', '5 pessoas · 3 com conta', 'Última atividade: hoje', '#F2913D', { pro: true })}${poolCard('Casa de Família Silva', 'Membro', 'Free', '2 pessoas · 2 com conta', 'Última atividade: há 3 dias', '#3BA7F2')}
  <div class="empty" style="justify-content:center;cursor:pointer"><span class="type-ico" style="background:var(--accent-soft);color:var(--accent-2);width:40px;height:40px">${ico('plus')}</span><b>Criar agregado</b><span>Começa um novo agregado como proprietário.</span></div></div>
  <span class="card-sub">A app abre diretamente no último agregado usado.</span>`);
const poolsPrimeiro = () => poolsShell(`
  <div style="max-width:520px;margin:32px auto 0;width:100%;display:flex;flex-direction:column;gap:20px">
  <div><h1 style="font-size:var(--fs-2xl);font-weight:700;margin:0">Vamos criar o teu agregado</h1><p class="card-sub" style="margin:6px 0 0">Um agregado é a tua família ou casa: reúne as contas, investimentos e despesas partilhados.</p></div>
  <div class="card"><form style="display:flex;flex-direction:column;gap:14px">${field('Nome do agregado', inp('Família Rocha', 'style="height:40px"'), 'Podes mudar mais tarde.')}
  <div class="note">Serás o <b>proprietário</b>. Depois podes convidar outras pessoas por email e escolher a função de cada uma.</div>
  ${btn('Criar agregado', { primary: true }).replace('btn primary', 'btn primary lg')}</form></div>
  <div class="divider">ou</div><div class="card" style="flex-direction:row;align-items:center;gap:12px">${ico('mail')}<span class="fg2" style="flex:1;font-size:13px">Foste convidado para um agregado? Abre a ligação que recebeste por email.</span></div>
  <div class="card" style="flex-direction:row;align-items:center;gap:12px">${ico('down')}<span class="fg2" style="flex:1;font-size:13px">Já usavas o protótipo? Depois de criares o agregado podes importar a cópia JSON.</span></div></div>`);

/* ---------- 64 members settings ---------- */
const SET_TABS = ['Agregado e parâmetros', 'Plano e subscrição', 'Utilizadores e convites'];
const roleSel = (r, dis = false) => `<select class="sel" ${dis ? 'disabled' : ''}>${['Proprietário', 'Administrador', 'Membro', 'Leitor'].map((x) => `<option ${x === r ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
const memberRow = (n, c, email, role, joined, last, { me = false, owner = false } = {}) => `<tr><td><div class="asset-cell">${avatar(n, c)}<div class="nm"><b>${n}${me ? ' ' + chip('Tu', 'accent') : ''}</b><span>${email}</span></div></div></td><td>${roleSel(role, owner)}</td><td>${joined}</td><td>${last}</td><td><div class="row-acts">${me ? `<button class="btn ghost sm">${ico('logout')}Sair</button>` : `<button class="btn ghost sm danger">${ico('trash')}Remover</button>`}</div></td></tr>`;
const membros = () => page('definicoes', 'Definições', `${pagebar('Convida as pessoas do agregado e escolhe o que cada uma pode fazer.', btn('Convidar utilizador', { icon: 'plus', primary: true }))}${tabs(SET_TABS, 2)}<div class="grid">
  <div class="card c12"><div class="card-h"><h3>Utilizadores</h3><span class="card-sub">3 com conta · Pro: sem limite</span></div><div class="tbl-wrap"><table><thead><tr><th>Nome</th><th>Função</th><th>Entrou em</th><th>Última atividade</th><th></th></tr></thead><tbody>
  ${memberRow('Rui', '#F2913D', 'rui@exemplo.pt', 'Proprietário', '11/10/2026', 'agora', { me: true, owner: true })}${memberRow('Ana', '#9D6BFF', 'ana@exemplo.pt', 'Administrador', '12/10/2026', 'há 2 horas')}${memberRow('Liliana', '#3CCB7F', 'liliana@exemplo.pt', 'Membro', '12/10/2026', 'ontem')}</tbody></table></div>
  <div class="note">Os administradores não podem remover nem alterar proprietários. Mudar a função de uma pessoa termina as sessões dela neste agregado e fica registado.</div></div>
  <div class="card c7"><div class="card-h"><h3>Convites pendentes</h3></div><div class="tbl-wrap"><table><thead><tr><th>Email</th><th>Função</th><th>Expira</th><th></th></tr></thead><tbody>
  <tr><td>joao@exemplo.pt</td><td>${chip('Leitor')}</td><td>em 5 dias <small>(19/10/2026)</small></td><td><div class="row-acts"><button class="btn ghost sm">${ico('refresh')}Reenviar</button><button class="btn ghost sm danger">Cancelar</button></div></td></tr>
  <tr><td>marta@exemplo.pt</td><td>${chip('Membro')}</td><td><span class="warn">amanhã</span> <small>(14/10/2026)</small></td><td><div class="row-acts"><button class="btn ghost sm">${ico('refresh')}Reenviar</button><button class="btn ghost sm danger">Cancelar</button></div></td></tr></tbody></table></div><span class="card-sub">Cada convite é uma ligação de uso único válida durante 7 dias, só para esse email.</span></div>
  <div class="card c5"><div class="card-h"><h3>Propriedade do agregado</h3></div><span class="card-sub">Um agregado tem sempre pelo menos um proprietário.</span>
  <div class="toolbar">${btn('Transferir propriedade', { icon: 'swap' })}<button class="btn ghost danger" disabled>${ico('logout')}Sair do agregado</button></div><span class="card-sub">Não podes sair enquanto fores o único proprietário.</span></div></div>`, {});

/* ---------- 65 account ---------- */
const sessionRow = (icon, dev, loc, last, cur) => `<tr><td><div class="asset-cell"><span class="type-ico" style="width:30px;height:30px;background:var(--panel-2);color:var(--fg-2)">${ico(icon)}</span><div class="nm"><b>${dev}${cur ? ' ' + chip('Esta sessão', 'pos') : ''}</b><span>${loc}</span></div></div></td><td>${last}</td><td><div class="row-acts">${cur ? '' : '<button class="btn ghost sm danger">Terminar</button>'}</div></td></tr>`;
const conta = () => page('conta', 'A minha conta', `${pagebar('Os teus dados pessoais e a segurança da tua conta. Aplicam-se a todos os agregados a que pertences.')}<div class="grid">
  <div class="card c6"><div class="card-h"><h3>Perfil</h3></div><div style="display:flex;gap:14px;align-items:center"><span class="av" style="background:#F2913D;width:48px;height:48px;font-size:18px;border:0;margin:0">R</span><div style="display:flex;flex-direction:column"><b>Rui Rocha</b><span class="card-sub">Proprietário de Família Rocha</span></div></div>
  <div class="fields">${field('Nome', inp('Rui Rocha'))}${field('Email', `<div class="iw"><input class="input" value="rui@exemplo.pt" style="padding-right:90px"><span style="position:absolute;right:8px;top:6px">${chip('Verificado', 'pos')}</span></div>`, 'Alterar o email exige confirmação no novo endereço.')}</div><div class="toolbar" style="justify-content:flex-end">${btn('Guardar perfil', { primary: true })}</div></div>
  <div class="card c6"><div class="card-h"><h3>Palavra-passe</h3></div><div class="fields">${field('Palavra-passe atual', inp('••••••••••••', 'type="password"'), '', true)}${field('Nova palavra-passe', inp('', 'type="password" placeholder="Mínimo de 12 caracteres"'))}${field('Confirmar', inp('', 'type="password"'))}</div>
  <div class="alert info">${ico('info')}<div>Ao alterar, terminamos a sessão em todos os outros dispositivos.</div></div><div class="toolbar" style="justify-content:flex-end">${btn('Alterar palavra-passe', { primary: true })}</div></div>
  <div class="card c12"><div class="card-h"><h3>Sessões ativas</h3>${btn('Terminar todas as outras', { sm: true, icon: 'logout' })}</div><span class="card-sub">Dispositivos com a tua conta aberta. A sessão dura 30 dias de atividade.</span><div class="tbl-wrap"><table><thead><tr><th>Dispositivo</th><th>Última atividade</th><th></th></tr></thead><tbody>
  ${sessionRow('monitor', 'Chrome em macOS', 'Lisboa, PT (aproximado) · 192.168.1.x', 'agora', true)}${sessionRow('phone', 'Safari em iPhone', 'Lisboa, PT (aproximado) · 85.240.x.x', 'há 3 horas')}${sessionRow('monitor', 'Firefox em Windows', 'Porto, PT (aproximado) · 188.37.x.x', 'há 12 dias')}</tbody></table></div></div>
  <div class="card c6"><div class="card-h"><h3>Autenticação em dois passos</h3>${chip('Em breve')}</div><span class="card-sub">Vais poder proteger a conta com uma aplicação de autenticação e códigos de recuperação.</span><div class="toolbar"><button class="btn" disabled>${ico('shield')}Ativar</button></div></div>
  <div class="card c6"><div class="card-h"><h3>Os meus dados</h3></div><span class="card-sub">Descarrega uma cópia dos teus dados em JSON.</span><div class="toolbar">${btn('Exportar os meus dados', { icon: 'down' })}</div>
  <div style="border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:8px"><b class="neg" style="font-size:13px">Eliminar conta</b><span class="card-sub">Apaga a tua conta e remove-te dos agregados. Não apaga agregados com outros membros.</span><div class="toolbar">${btn('Eliminar a minha conta', { icon: 'trash', danger: true })}</div></div></div></div>`, {});

/* ---------- modals ---------- */
const mInvite = () => modalShell({ title: 'Convidar utilizador', body: `<div class="fields">${field('Email', inp('joao@exemplo.pt'), 'Só esta pessoa poderá aceitar o convite.', true)}${field('Função', select(['Administrador', 'Membro', 'Leitor'], 'Leitor'), '', true)}</div>
  <div class="blist" style="font-size:12px"><div class="r"><span class="n"><b>Administrador</b></span><span class="fg2">gere contas, portfolios, categorias e convites</span></div><div class="r"><span class="n"><b>Membro</b></span><span class="fg2">cria e edita movimentos e importa extratos</span></div><div class="r"><span class="n"><b>Leitor</b></span><span class="fg2">só consulta os dados</span></div></div>
  <div class="note">Enviamos um email com uma ligação de uso único, válida durante <b>7 dias</b>.</div>`, footer: `${btn('Cancelar', { ghost: true })}${btn('Enviar convite', { primary: true, icon: 'mail' })}` });
const mTransfer = () => modalShell({ title: 'Transferir propriedade', body: `<p style="margin:0" class="fg2">A nova pessoa passa a ser proprietária de <b style="color:var(--fg)">Família Rocha</b> e pode apagar o agregado e gerir o plano.</p>
  <div class="fields">${field('Novo proprietário', select(['Ana (ana@exemplo.pt)', 'Liliana (liliana@exemplo.pt)'], 'Ana (ana@exemplo.pt)'), '', true)}${field('Confirma com a tua palavra-passe', inp('••••••••••••', 'type="password"'), '', true)}</div>
  ${alert('warn', 'alert', 'Passas a <b>Administrador</b>. Só o novo proprietário pode voltar a mudar isto.')}`, footer: `${btn('Cancelar', { ghost: true })}${btn('Transferir propriedade', { primary: true })}` });
const mDelete = () => modalShell({ title: 'Eliminar conta', body: `${alert('err', 'alert', '<b>Não é possível eliminar a conta agora.</b><br><span class="fg2">És o único proprietário de <b>Família Rocha</b>, que tem mais 2 utilizadores. Transfere a propriedade ou remove os outros utilizadores primeiro.</span>')}
  <div class="note">Podes eliminar um agregado sem outros membros, ou transferir a propriedade e depois eliminar a tua conta.</div>`, footer: `${btn('Fechar', { ghost: true })}${btn('Transferir propriedade', { primary: true, icon: 'swap' })}` });


/* ---------- pool settings (Definições → Agregado e parâmetros) ---------- */
const danger = (label, icon) => `<button class="btn danger" style="border-color:var(--neg)">${ico(icon)}${label}</button>`;
const agregado = (switcher = 'closed') => page('definicoes', 'Definições', `${pagebar('Dados e parâmetros do agregado. Só o proprietário pode alterar o agregado, a propriedade e o plano.')}${tabs(SET_TABS, 0)}<div class="grid">
  <div class="card c6"><div class="card-h"><h3>Dados do agregado</h3>${chip('Pro', 'accent')}</div>
    <div class="fields">${field('Nome do agregado', inp('Família Rocha'), '1–60 caracteres.', true)}${field('Moeda base', `<select class="input" disabled><option>EUR · Euro</option></select>`, 'Os valores de outras moedas são convertidos para esta.')}${field('Criado em', inp('11/10/2026', 'disabled'))}</div>
    <dl class="kv"><dt>Proprietário</dt><dd>Rui</dd><dt>Utilizadores com conta</dt><dd>3</dd><dt>Pessoas (titulares)</dt><dd>5</dd></dl><div class="toolbar" style="justify-content:flex-end">${btn('Guardar nome', { primary: true })}</div></div>
  <div class="card c6"><div class="card-h"><h3>Parâmetros</h3></div><div class="fields">${field('1 USD em EUR', inp('0,92'))}${field('1 GBP em EUR', inp('1,17'))}${field('1 CHF em EUR', inp('1,05'))}${field('Imposto sobre juros (%)', inp('28'), 'Em Portugal, 28% sobre juros de depósitos.')}${field('Imposto sobre dividendos (%)', inp('28'))}${field('Janela para transferências (dias)', inp('3'))}</div><div class="toolbar" style="justify-content:flex-end">${btn('Guardar parâmetros', { primary: true })}</div></div>
  <div class="card c6"><div class="card-h"><h3>Dados e cópia de segurança</h3></div><span class="card-sub">Exporta todos os dados do agregado em JSON (contas, movimentos, investimentos, notas, imobiliário). Só o proprietário pode exportar.</span><div class="toolbar">${btn('Exportar o agregado (JSON)', { icon: 'down' })}${btn('Importar cópia do protótipo', { icon: 'refresh' })}</div></div>
  <div class="card c6" style="border:1px solid var(--neg)"><div class="card-h"><h3 class="neg">Zona de perigo</h3></div>
    <div class="fr" style="gap:12px"><div><b style="font-size:13px">Transferir propriedade</b><div class="card-sub">Passa a propriedade a outra pessoa do agregado.</div></div>${btn('Transferir', { icon: 'swap' })}</div>
    <div class="fr" style="gap:12px;border-top:1px solid var(--line);padding-top:12px"><div><b style="font-size:13px">Sair do agregado</b><div class="card-sub">Não podes sair enquanto fores o único proprietário.</div></div><button class="btn" disabled>${ico('logout')}Sair</button></div>
    <div class="fr" style="gap:12px;border-top:1px solid var(--line);padding-top:12px"><div><b style="font-size:13px">Eliminar o agregado</b><div class="card-sub">Apaga todos os dados do agregado de forma permanente.</div></div>${danger('Eliminar agregado', 'trash')}</div></div></div>`, { switcher });

const mDeletePool = () => modalShell({ title: 'Eliminar agregado', body: `${alert('err', 'alert', '<b>Esta ação é permanente e não pode ser desfeita.</b>')}
  <div class="blist" style="font-size:13px"><div style="display:flex;gap:8px">${ico('x')}<span>Todas as contas, movimentos, portfolios, objetivos, imobiliário e notas de <b>Família Rocha</b> são apagados.</span></div><div style="display:flex;gap:8px">${ico('users')}<span>2 utilizadores perdem o acesso. As contas pessoais deles não são apagadas.</span></div><div style="display:flex;gap:8px">${ico('down')}<span>Exporta uma cópia antes de continuar.</span></div></div>
  <div class="toolbar">${btn('Exportar o agregado (JSON)', { icon: 'down', sm: true })}</div>
  <div class="fields">${field('Escreve o nome do agregado para confirmar', inp('Família Rocha'), '', true)}${field('A tua palavra-passe', inp('••••••••••••', 'type="password"'), '', true)}</div>`, footer: `${btn('Cancelar', { ghost: true })}<button class="btn primary" style="background:var(--neg);border-color:var(--neg)">${ico('trash')}Eliminar agregado</button>` });
const mLeavePool = () => modalShell({ title: 'Sair do agregado', body: `<p style="margin:0" class="fg2">Vais deixar de ter acesso a <b style="color:var(--fg)">Família Rocha</b>.</p>
  <div class="blist" style="font-size:13px"><div style="display:flex;gap:8px">${ico('check')}<span>Os movimentos e notas que criaste ficam no agregado.</span></div><div style="display:flex;gap:8px">${ico('check')}<span>A tua conta pessoal e os outros agregados não mudam.</span></div><div style="display:flex;gap:8px">${ico('mail')}<span>Só voltas a entrar com um novo convite.</span></div></div>`, footer: `${btn('Cancelar', { ghost: true })}${btn('Sair do agregado', { primary: true, icon: 'logout' })}` });
const mLeaveBlocked = () => modalShell({ title: 'Sair do agregado', body: `${alert('warn', 'alert', '<b>És o único proprietário de Família Rocha.</b><br><span class="fg2">Um agregado tem de ter sempre pelo menos um proprietário. Transfere a propriedade para outra pessoa antes de saíres.</span>')}`, footer: `${btn('Fechar', { ghost: true })}${btn('Transferir propriedade', { primary: true, icon: 'swap' })}` });
const mRemoveMember = () => modalShell({ title: 'Remover Liliana do agregado?', body: `<div class="who-box">${avatar('Liliana', '#3CCB7F')}<div style="flex:1"><b>Liliana</b><br><span class="card-sub">liliana@exemplo.pt · Membro</span></div></div>
  <div class="blist" style="font-size:13px"><div style="display:flex;gap:8px">${ico('lock')}<span>Perde o acesso imediatamente e as sessões dela neste agregado terminam.</span></div><div style="display:flex;gap:8px">${ico('check')}<span>Os movimentos e notas que criou ficam no agregado.</span></div><div style="display:flex;gap:8px">${ico('user')}<span>Liliana continua como pessoa sem conta (titular) nas contas e portfolios.</span></div></div><span class="card-sub">Fica registado no histórico de auditoria.</span>`, footer: `${btn('Cancelar', { ghost: true })}<button class="btn primary" style="background:var(--neg);border-color:var(--neg)">${ico('trash')}Remover</button>` });
const mChangeRole = () => modalShell({ title: 'Alterar função de Ana', body: `<div class="who-box">${avatar('Ana', '#9D6BFF')}<div style="flex:1"><b>Ana</b><br><span class="card-sub">ana@exemplo.pt</span></div>${chip('Administrador')}<span class="muted">→</span>${chip('Membro', 'accent')}</div>
  <div class="fields"><div class="f"><label class="pos">Mantém</label><div class="reqs"><div class="ok">${ico('check')}Ver todos os dados</div><div class="ok">${ico('check')}Criar e editar movimentos</div><div class="ok">${ico('check')}Importar extratos</div></div></div><div class="f"><label class="neg">Perde</label><div class="reqs"><div class="no" style="color:var(--neg)">${ico("x")}Gerir contas e portfolios</div><div class="no" style="color:var(--neg)">${ico("x")}Gerir categorias e objetivos</div><div class="no" style="color:var(--neg)">${ico("x")}Convidar e remover membros</div></div></div></div>
  ${alert('info', 'info', 'A sessão da Ana neste agregado termina e ela volta a entrar com as novas permissões. A alteração fica registada.')}`, footer: `${btn('Cancelar', { ghost: true })}${btn('Alterar função', { primary: true })}` });

module.exports = { agregado, mDeletePool, mLeavePool, mLeaveBlocked, mRemoveMember, mChangeRole, login, registar, registarFechado, recuperar, recuperarEnviado, recuperarNova, recuperarInvalido, verificarPendente, verificarSucesso, convitePublico, conviteAceitar, conviteDiferente, conviteExpirado, pools, poolsPrimeiro, membros, conta, mInvite, mTransfer, mDelete };
