import { normalizeText } from '@nestvault/domain';

import type { PrototypeExport } from './schema';

// `migrate` of the prototype (cofre-familiar-v28.html), for files written by older versions. The
// shape defaults (`aliases`, `ccy`, `members`, `budget`…) are applied by the mapper where each field
// is read; what lives here is the part that adds data: the default categories and keyword rules
// that versions 3 to 6 introduced. Categories are matched by name, as the prototype does.

type Category = NonNullable<PrototypeExport['categories']>[number];
type Rule = NonNullable<PrototypeExport['rules']>[number];

/** The prototype's `DEFAULT_RULES`: category name and the keywords that file a movement under it. */
export const DEFAULT_RULES: readonly (readonly [string, readonly string[]])[] = [
  [
    'Restauração',
    [
      'UBER EATS',
      'GLOVO',
      'BOLT FOOD',
      'RESTAURANTE',
      'MCDONALDS',
      'PASTELARIA',
      'CAFE',
      'PADARIA',
      'NESPRESSO',
    ],
  ],
  [
    'Supermercado',
    [
      'CONTINENTE',
      'PINGO DOCE',
      'LIDL',
      'MERCADONA',
      'AUCHAN',
      'INTERMARCHE',
      'MINIPRECO',
      'ALDI',
      'SPAR',
    ],
  ],
  [
    'Combustível',
    ['GALP', 'REPSOL', 'BP ', 'PRIO', 'CEPSA', 'SOC. COMB', 'ESTACION SERVICIO', 'COMBUSTIVEIS'],
  ],
  [
    'Transportes',
    [
      'VIA VERDE',
      'PORTAGEM',
      'VIA RAPIDA',
      'UBER',
      'BOLT',
      'METRO',
      'CP-COMBOIOS',
      'CARRIS',
      'NAVEGANTE',
      'PARQUE',
    ],
  ],
  ['Utilidades (luz, água, gás)', ['EDP', 'GOLDENERGY', 'ENDESA', 'EPAL', 'AGUAS', 'IBERDROLA']],
  ['Telecomunicações', ['MEO', 'NOS ', 'VODAFONE', 'DIGI', 'NOWO', 'ALTICE']],
  [
    'Subscrições',
    [
      'NETFLIX',
      'SPOTIFY',
      'DISNEY',
      'APPLE.COM',
      'HBO',
      'YOUTUBE',
      'AMAZON PRIME',
      'ANTHROPIC',
      'OPENAI',
    ],
  ],
  ['Saúde', ['FARMACIA', 'CUF', 'LUZ SAUDE', 'HOSPITAL', 'CLINICA', 'DENTISTA']],
  [
    'Habitação',
    [
      'PRESTACAO',
      'CREDITO HAB',
      'JUROS DE EMPRESTIMO',
      'AMORTIZACAO DE CAPITAL',
      'CONDOMINIO',
      'RENDA',
    ],
  ],
  ['Comissões bancárias', ['IMPOSTO DE SELO', 'MANUTENCAO DE CONTA', 'COMISSAO']],
  ['Levantamentos (numerário)', ['LEV. ATM', 'LEVANTAMENTO']],
  ['Impostos', ['AT -', 'FINANCAS', 'IMI', 'IUC', 'SEG SOCIAL']],
  [
    'Seguros',
    ['FIDELIDADE', 'AGEAS', 'TRANQUILIDADE', 'ALLIANZ', 'GENERALI', 'SEGURO', 'REALVSEGUROS'],
  ],
  ['Compras', ['ZARA', 'WORTEN', 'FNAC', 'AMAZON', 'IKEA', 'DECATHLON', 'PRIMARK', 'ZIPPY']],
  ['Educação', ['ESCOLA', 'PROPINA', 'COLEGIO', 'LIVRARIA']],
  [
    'Desporto e ginásio',
    [
      'GINASIO',
      'FITNESS',
      'HOLMES PLACE',
      'SOLINCA',
      'GO FIT',
      'PILATES',
      'CROSSFIT',
      'PERSONAL TRAINER',
    ],
  ],
  ['Salário', ['VENCIMENTO', 'ORDENADO', 'SALARIO']],
  ['Juros e dividendos', ['JUROS', 'DIVIDENDO', 'INTEREST']],
  ['Outros rendimentos', ['ADSE']],
  [
    'Investimento',
    [
      'DEGIRO',
      'TRADING 212',
      'XTB',
      'INTERACTIVE BROKERS',
      'LIGHTYEAR',
      'TRADE REPUBLIC',
      'BANCO INVEST',
    ],
  ],
];

/** Categories each version added: `[name, kind, colour]`, applied to files older than that version. */
const ADDED_BY_VERSION: readonly {
  before: number;
  categories: readonly [string, string, string][];
}[] = [
  {
    before: 3,
    categories: [
      ['Levantamentos (numerário)', 'expense', '#C9A227'],
      ['Comissões bancárias', 'expense', '#7779A6'],
    ],
  },
  {
    before: 4,
    categories: [
      ['Envios para contas próprias fora da app', 'expense', '#C9A227'],
      ['Reembolsos', 'refund', '#2BC6B4'],
    ],
  },
  { before: 6, categories: [['Desporto e ginásio', 'expense', '#3CCB7F']] },
];

export interface MigratedLists {
  categories: Category[];
  rules: Rule[];
  /** How many default keyword rules an older file was topped up with. */
  rulesAdded: number;
}

/**
 * The categories and rules of the file as the current prototype version would hold them after
 * `migrate`. A file at version 6 is returned as it is.
 */
export function migrateLists(data: PrototypeExport): MigratedLists {
  const version = data.v ?? 1;
  const categories: Category[] = [...(data.categories ?? [])];
  const rules: Rule[] = [...(data.rules ?? [])];
  if (version >= 6) return { categories, rules, rulesAdded: 0 };

  const named = (name: string) =>
    categories.find((c) => normalizeText(c.name) === normalizeText(name));
  let added = 0;
  for (const step of ADDED_BY_VERSION) {
    if (version >= step.before) continue;
    for (const [name, kind, color] of step.categories) {
      if (!named(name)) {
        added += 1;
        categories.push({ id: `migrated-category-${added}`, name, kind, color, budget: 0 });
      }
    }
  }

  // Versions 3, 5 and 6 each topped the rules up with every default keyword the file lacked.
  const have = new Set(rules.map((rule) => normalizeText(rule.kw)));
  let rulesAdded = 0;
  for (const [categoryName, keywords] of DEFAULT_RULES) {
    const category = named(categoryName);
    if (!category) continue;
    for (const keyword of keywords) {
      if (have.has(normalizeText(keyword))) continue;
      have.add(normalizeText(keyword));
      rulesAdded += 1;
      rules.push({ id: `migrated-rule-${rulesAdded}`, kw: keyword, cat: category.id, acc: '' });
    }
  }
  return { categories, rules, rulesAdded };
}
