import { NotFoundError } from '../errors';

import type { TemplateName } from './schemas';

// The two downloadable CSV templates. They are the same text as `services/parser/templates/*.csv`
// (a test compares them), which the parser service reads back with its `loan-installments-csv` and
// `works-payments-csv` code parsers.

const TEMPLATES: Readonly<Record<TemplateName, string>> = {
  'loan-installments':
    'Número;Data;Capital;Juros;Seguro vida;Seguro casa;Seguro crédito;Comissões;Imposto de selo\n' +
    '1;2026-01-05;120,50;310,25;12,40;0;0;0;12,41\n' +
    '2;2026-02-05;121,10;309,65;12,40;0;0;0;12,39\n',
  'works-payments':
    'Obra;Descrição;Valor;Data prevista;Data de pagamento\n' +
    'Kitchen;Deposit;1500;2026-01-10;2026-01-12\n' +
    'Kitchen;Final payment;2500;2026-03-01;\n',
};

export const TEMPLATE_FILE_NAMES: Readonly<Record<TemplateName, string>> = {
  'loan-installments': 'loan-installments.csv',
  'works-payments': 'works-payments.csv',
};

export function templateText(name: string): { name: TemplateName; text: string } {
  if (!Object.hasOwn(TEMPLATES, name)) throw new NotFoundError();
  const key = name as TemplateName;
  return { name: key, text: TEMPLATES[key] };
}
