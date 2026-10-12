/* Renders the real estate + plan mockups to design/mockups/{escuro,claro}/*.png
   Usage (from the repo root):  NODE_PATH=$(npm root -g) node design/mockups/src/build.cjs [filter]
   Needs Playwright with Chromium. `filter` renders only outputs whose name contains it. */
const { fs, path, ROOT, doc } = require('./lib.cjs');
const P = require('./pages.cjs');
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
      const mobile = kind.startsWith('mobile');
      const html = doc({ theme: theme === 'escuro' ? 'dark' : 'light', body: typeof r === 'string' && kind !== 'modal' ? r : r.body || '', modal: kind === 'modal' ? r : r.modal || '', mobile });
      const file = path.join(tmp, `${theme}-${name}.html`);
      fs.writeFileSync(file, html);
      const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: kind === 'modal' ? 1600 : 900 }, deviceScaleFactor: mobile ? 2 : 1, colorScheme: theme === 'escuro' ? 'dark' : 'light' });
      const page = await ctx.newPage();
      await page.goto('file://' + file);
      await page.evaluate(() => document.fonts.ready);
      const out = path.join(dir, name + '.png');
      if (kind === 'modal') {
        await page.locator('.modal').screenshot({ path: out });
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
