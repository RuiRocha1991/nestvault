/* Renders the real estate + plan mockups to design/mockups/{escuro,claro}/*.png
   Usage (from the repo root):  NODE_PATH=$(npm root -g) node design/mockups/src/build.cjs [filter]
   Needs Playwright with Chromium. `filter` renders only outputs whose name contains it. */
const { fs, path, ROOT, doc } = require('./lib.cjs');
const P = require('./pages.cjs');
const A = require('./auth.cjs');
const { chromium } = require('playwright');

const OUT = path.join(ROOT, 'design/mockups');
const tmp = path.join(require('node:os').tmpdir(), 'nestvault-mockups');
fs.mkdirSync(tmp, { recursive: true });

/* kind: 'page' (full height), 'view' (viewport with an open dialog), 'modal' (dialog only), 'mobile' */
const jobs = [
  ['27-imobiliario-lista', 'page', () => P.imobiliarioLista()],
  ['28-imovel-resumo', 'page', () => P.imovelResumo()],
  ['29-imovel-prestacoes', 'page', () => P.imovelPrestacoes()],
  ['45-imovel-prestacoes-colunas', 'page', () => P.imovelPrestacoes(undefined, { popover: true })],
  ['30-imovel-eventos-e-anos', 'page', () => P.imovelEventos()],
  ['31-imovel-obras', 'page', () => P.imovelObras()],
  ['32-imovel-venda-e-simulador', 'page', () => P.imovelVenda()],
  ['33-imobiliario-free-pre-visualizacao', 'page', () => P.imobiliarioLista(P.demo, { free: true })],
  ['34-imovel-free-dialogo-pro', 'view', () => ({ body: P.imovelResumo(P.demo, { free: true }), modal: P.dialogPro({ feature: 'real_estate' }) })],
  ['35-definicoes-plano', 'page', () => P.definicoesPlano()],
  ['36-definicoes-utilizadores-free', 'page', () => P.definicoesUtilizadores()],
  ['modal-37-ativar-pro', 'modal', () => P.dialogPro({ feature: 'real_estate' })],
  ['modal-38-ativar-pro-membro-sem-permissao', 'modal', () => P.dialogPro({ member: true })],
  ['modal-39-limite-do-plano-free', 'modal', () => P.dialogLimit()],
  ['modal-40-novo-imovel', 'modal', () => P.mNewProperty()],
  ['modal-41-novo-emprestimo', 'modal', () => P.mNewLoan()],
  ['modal-42-evento-do-emprestimo', 'modal', () => P.mLoanEvent()],
  ['modal-43-nova-obra', 'modal', () => P.mNewWorks()],
  ['modal-46-novo-campo-da-prestacao', 'modal', () => P.mNewField()],
  ['modal-44-importar-folha-de-calculo', 'modal', () => P.mImport()],
  ['mobile-07-imovel-resumo', 'mobile', () => P.imovelResumo()],
  ['47-login', 'auth', () => A.login()],
  ['48-login-credenciais-invalidas', 'auth', () => A.login({ error: true })],
  ['49-login-demasiadas-tentativas', 'auth', () => A.login({ locked: true })],
  ['50-registar', 'auth', () => A.registar()],
  ['51-registar-fechado', 'auth', () => A.registarFechado()],
  ['52-recuperar-palavra-passe', 'auth', () => A.recuperar()],
  ['53-recuperar-email-enviado', 'auth', () => A.recuperarEnviado()],
  ['54-recuperar-nova-palavra-passe', 'auth', () => A.recuperarNova()],
  ['55-recuperar-ligacao-invalida', 'auth', () => A.recuperarInvalido()],
  ['56-verificar-email-pendente', 'auth', () => A.verificarPendente()],
  ['57-verificar-email-confirmado', 'auth', () => A.verificarSucesso()],
  ['58-convite', 'auth', () => A.convitePublico()],
  ['59-convite-aceitar', 'auth', () => A.conviteAceitar()],
  ['60-convite-email-diferente', 'auth', () => A.conviteDiferente()],
  ['61-convite-expirado', 'auth', () => A.conviteExpirado()],
  ['62-agregados-escolher', 'auth', () => A.pools()],
  ['63-agregados-criar-primeiro', 'auth', () => A.poolsPrimeiro()],
  ['64-definicoes-utilizadores-e-convites', 'page', () => A.membros()],
  ['65-conta', 'page', () => A.conta()],
  ['69-definicoes-agregado', 'page', () => A.agregado('closed')],
  ['70-seletor-de-agregado', 'page', () => A.agregado('open')],
  ['76-definicoes-auditoria', 'page', () => A.auditoria()],
  ['77-definicoes-auditoria-detalhe', 'page', () => A.auditoria({ detail: true })],
  ['78-definicoes-auditoria-sem-resultados', 'page', () => A.auditoria({ empty: true })],
  ['mobile-12-auditoria', 'mobile', () => A.auditoria()],
  ['modal-71-eliminar-agregado', 'modal', () => A.mDeletePool()],
  ['modal-72-sair-do-agregado', 'modal', () => A.mLeavePool()],
  ['modal-73-sair-do-agregado-bloqueado', 'modal', () => A.mLeaveBlocked()],
  ['modal-74-remover-membro', 'modal', () => A.mRemoveMember()],
  ['modal-75-alterar-funcao', 'modal', () => A.mChangeRole()],
  ['modal-66-convidar-utilizador', 'modal', () => A.mInvite()],
  ['modal-67-transferir-propriedade', 'modal', () => A.mTransfer()],
  ['modal-68-eliminar-conta-bloqueado', 'modal', () => A.mDelete()],
  ['mobile-09-login', 'auth-mobile', () => A.login()],
  ['mobile-10-registar', 'auth-mobile', () => A.registar()],
  ['mobile-11-convite', 'auth-mobile', () => A.convitePublico()],
  ['mobile-08-imobiliario-free-dialogo-pro', 'mobile-view', () => ({ body: P.imobiliarioLista(P.demo, { free: true }), modal: P.dialogPro({ feature: 'real_estate' }) })],
];

(async () => {
  const filter = process.argv[2] || '';
  const browser = await chromium.launch();
  for (const theme of ['escuro', 'claro']) {
    const dir = path.join(OUT, theme);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, kind, make] of jobs) {
      if (filter && !name.includes(filter)) continue;
      const r = make();
      const mobile = kind.startsWith('mobile') || kind === 'auth-mobile';
      const bare = kind.startsWith('auth');
      const html = doc({ theme: theme === 'escuro' ? 'dark' : 'light', body: typeof r === 'string' && kind !== 'modal' ? r : r.body || '', modal: kind === 'modal' ? r : r.modal || '', mobile, bare });
      const file = path.join(tmp, `${theme}-${name}.html`);
      fs.writeFileSync(file, html);
      const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: kind === 'modal' ? 1600 : 900 }, deviceScaleFactor: mobile ? 2 : 1, colorScheme: theme === 'escuro' ? 'dark' : 'light' });
      const page = await ctx.newPage();
      await page.goto('file://' + file);
      await page.evaluate(() => document.fonts.ready);
      const out = path.join(dir, name + '.png');
      if (kind === 'modal') {
        await page.locator('.modal').screenshot({ path: out });
      } else if (bare) {
        const h = await page.evaluate(() => Math.ceil(document.querySelector('.auth').scrollHeight));
        await page.setViewportSize({ width: mobile ? 390 : 1440, height: Math.max(h, mobile ? 844 : 900) });
        await page.screenshot({ path: out });
      } else if (kind === 'page' || kind === 'mobile') {
        const h = await page.evaluate(() => Math.ceil(document.querySelector('.main').scrollHeight));
        await page.setViewportSize({ width: mobile ? 390 : 1440, height: h });
        await page.screenshot({ path: out });
      } else {
        await page.screenshot({ path: out });
      }
      await ctx.close();
      console.log('wrote', path.relative(ROOT, out));
    }
  }
  await browser.close();
})();
