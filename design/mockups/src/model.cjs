/* Mock data. The "pro" model reproduces the owner's spreadsheet "Crédito Habitação com Obras"
   (73 installments paid through 09/2026, 15 000 € prepayment in 02/2023, 4 works projects).
   The "demo" model is fictional data shown to Free plan users (read-only preview). */
const { annuity, sum, r2, pmt, addMonths, eur } = require('./lib.cjs');
const sheetRows = require('./sheet-installments.json'); // [n, ym, capital, interest, fees, tax, life, home, credit, total]

function summarize(m) {
  const paid = m.paidRows, proj = m.projRows;
  const capitalPaid = r2(sum(paid, (r) => r[2]) + sum(m.prepayments, (p) => p.amount));
  const interestPaid = r2(sum(paid, (r) => r[3]));
  const feesPaid = r2(sum(paid, (r) => r[4] + r[5]));
  const lifePaid = r2(sum(paid, (r) => r[6])), homePaid = r2(sum(paid, (r) => r[7])), creditPaid = r2(sum(paid, (r) => r[8]));
  const debt = r2(m.principal - capitalPaid);
  const acq = r2(sum(m.acqItems, (i) => i[1]));
  const worksPaid = r2(sum(m.works, (w) => w.paid));
  const worksBudget = r2(sum(m.works, (w) => w.total));
  const costCredit = r2(interestPaid + feesPaid + lifePaid + homePaid + creditPaid);
  const invested = r2(m.down + capitalPaid + acq + worksPaid);
  const totalSpent = r2(invested + costCredit);
  const equity = r2(m.value - debt);
  const next = proj[0];
  const interestRemaining = r2(sum(proj, (r) => r[3]));
  return { ...m, capitalPaid, interestPaid, feesPaid, lifePaid, homePaid, creditPaid, debt, acq, worksPaid, worksBudget, costCredit, invested, totalSpent, equity, next, interestRemaining,
    endYM: proj[proj.length - 1][1], remaining: proj.length, paidCount: paid.length, totalCount: paid.length + proj.length };
}

/* ---------- Pro: the spreadsheet ---------- */
const INS_NOW = { life: 12.39, home: 18.76, credit: 36.02 };
const paidPro = sheetRows;
const principal = 111600;
const balPro = r2(principal - sum(paidPro, (r) => r[2]) - 15000);
const projPro = annuity(balPro, 0.024, 384, 74, '2026-10', INS_NOW);

const pay = (n) => eur(r2(paidPro[n - 1][2] + paidPro[n - 1][3]));
const pro = summarize({
  key: 'pro', name: 'Apartamento T3', kind: 'Casa de morada', type: 'primary',
  holders: [['Rui', '#F2913D', 50], ['Ana', '#9D6BFF', 50]],
  price: 124000, down: 12400, principal, termMonths: 480, startYM: '2020-09',
  value: 250000, valueYM: '2026-09', valueSource: 'Estimativa manual',
  acqItems: [['Escritura', 915.0], ['IMT', 631.86], ['Imposto de selo', 992.0], ['Despesas bancárias', 20.85]],
  sellCostPct: 5, rate: 2.4, euribor: 1.9, spread: 0.5, index: 'Euribor 6M', nextReview: '03/2027',
  paidRows: paidPro, projRows: projPro, ins: INS_NOW,
  prepayments: [{ ym: '2023-02', day: '01', amount: 15000, fee: 0, effect: 'Reduzir prestação' }],
  works: [
    { id: 1, name: 'Obra inicial', desc: 'Ar condicionado, bomba de calor, portão automático na garagem, fogão e forno novos, reparação da estrutura do apartamento', supplier: '', total: 10000, depositPct: 100, paid: 10000, status: 'Concluído', phases: [], note: '' },
    { id: 2, name: 'Corredor e quarto dos miúdos', desc: 'Corredor e quarto dos miúdos', supplier: '', total: 2000, depositPct: 100, paid: 2000, status: 'Concluído', phases: [], note: '' },
    { id: 3, name: 'Cozinha', desc: 'Armários novos', supplier: 'Decozim', total: 9166, depositPct: 0, paid: 9166, status: 'Concluído', note: 'Desconto no valor final de 123 €',
      phases: [['Adjudicação e envio para produção', 4900, '2026-05-14', '2026-05-14'], ['Entrega do mobiliário', 2460, '2026-06-26', '2026-06-29'], ['Medição dos cerâmicos', 1230, '2026-06-26', '2026-07-09'], ['Conclusão da montagem', 576, '2026-07-21', '2026-07-21']] },
    { id: 4, name: 'Cozinha', desc: 'Mover bomba de calor', supplier: 'Drubloc', total: 905.46, depositPct: 50, paid: 905.46, status: 'Concluído', note: '',
      phases: [['Adjudicação', 452.73, '2026-05-26', '2026-05-25'], ['Finalização', 452.73, '2026-06-09', '2026-06-09']] },
  ],
  events: [
    { ym: '2020-09', kind: 'contract', title: 'Contrato do crédito', text: '111 600 € a 480 meses · taxa variável (Euribor 6M + spread)' },
    { ym: '2021-09', kind: 'review', title: 'Revisão da taxa', text: `Taxa 0,82% → 0,61% · prestação ${pay(12)} → ${pay(13)}` },
    { ym: '2022-09', kind: 'review', title: 'Revisão da taxa', text: `Taxa 0,61% → 2,09% · prestação ${pay(24)} → ${pay(25)} · juros passam a superar o capital` },
    { ym: '2023-02', kind: 'prepay', title: 'Amortização antecipada', text: `15 000 € · efeito: reduzir prestação · ${pay(30)} → ${pay(31)}` },
    { ym: '2023-09', kind: 'review', title: 'Revisão da taxa', text: 'Taxa 2,09% → 4,21%' },
    { ym: '2023-10', kind: 'reneg', title: 'Renegociação', text: `Prazo restante 420 prestações · taxa 4,10% · prestação ${pay(38)}` },
    { ym: '2026-04', kind: 'review', title: 'Revisão da taxa', text: `Taxa 4,10% → 2,40% · prestação ${pay(67)} → ${pay(68)}` },
  ],
  inflation: [[2020, -0.01], [2021, 1.27], [2022, 7.83], [2023, 4.3], [2024, 2.4], [2025, 2.3]],
});

/* ---------- Free preview: fictional data ---------- */
const INS_DEMO = { life: 14.2, home: 21.5, credit: 0 };
const demoAll = annuity(150000, 0.031, 360, 1, '2022-03', INS_DEMO);
const demo = summarize({
  key: 'demo', name: 'Apartamento Exemplo', kind: 'Casa de morada', type: 'primary',
  holders: [['Rui', '#F2913D', 50], ['Ana', '#9D6BFF', 50]],
  price: 185000, down: 35000, principal: 150000, termMonths: 360, startYM: '2022-03',
  value: 214000, valueYM: '2026-09', valueSource: 'Estimativa manual',
  acqItems: [['Escritura', 1100], ['IMT', 3120], ['Imposto de selo', 1480], ['Despesas bancárias', 450]],
  sellCostPct: 5, rate: 3.1, euribor: 2.6, spread: 0.5, index: 'Euribor 6M', nextReview: '03/2027',
  paidRows: demoAll.slice(0, 55), projRows: demoAll.slice(55), ins: INS_DEMO, prepayments: [],
  works: [
    { id: 1, name: 'Remodelação da cozinha', desc: 'Móveis, bancada e eletrodomésticos', supplier: 'Fornecedor Exemplo', total: 9200, depositPct: 30, paid: 9200, status: 'Concluído', note: '', phases: [] },
    { id: 2, name: 'Pintura e pavimentos', desc: 'Sala e quartos', supplier: 'Fornecedor Exemplo', total: 3300, depositPct: 50, paid: 1650, status: 'Em curso', note: '', phases: [] },
  ],
  events: [
    { ym: '2022-03', kind: 'contract', title: 'Contrato do crédito', text: '150 000 € a 360 meses · taxa variável' },
    { ym: '2024-03', kind: 'review', title: 'Revisão da taxa', from: 3.1, to: 3.1, text: 'Taxa mantida em 3,10%' },
  ],
  inflation: [[2022, 7.83], [2023, 4.3], [2024, 2.4], [2025, 2.3]],
});

/* contract years (installments 1–12 = year 1, …) */
function contractYears(m) {
  const all = [...m.paidRows.map((r) => ({ r, proj: false })), ...m.projRows.map((r) => ({ r, proj: true }))];
  const years = [];
  all.forEach(({ r, proj }) => {
    const y = Math.floor((r[0] - 1) / 12);
    years[y] = years[y] || { n: y + 1, start: m.startYM.slice(0, 4) * 1 + y, ym0: r[1], cp: 0, cj: 0, ip: 0, ij: 0, fees: 0, tax: 0, life: 0, home: 0, credit: 0, total: 0, paid: 0 };
    const Y = years[y];
    if (proj) { Y.cj += r[2]; Y.ij += r[3]; } else { Y.cp += r[2]; Y.ip += r[3]; Y.fees += r[4]; Y.tax += r[5]; Y.life += r[6]; Y.home += r[7]; Y.credit += r[8]; Y.total += r[9]; Y.paid++; }
  });
  return years;
}

module.exports = { pro, demo, contractYears, summarize, pmt, sheetRows };
