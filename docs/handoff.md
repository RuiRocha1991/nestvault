# Cofre Familiar — Kit de passagem para um novo chat

Este kit guarda tudo o que foi feito até à versão 28 do protótipo (11/10/2026), para continuar noutro chat sem perder nada.

## Links

- Protótipo funcional (artifact, versão 28): https://claude.ai/artifact/EqW3JjYZxRuRrFggXbAmXb
- PRD da versão servidor (Next.js + Postgres): https://claude.ai/code/artifact/7dde2c26-38d2-4c9b-9d36-644fb218da14
- Galeria de mockups e sistema de design: https://claude.ai/artifact/3ScNaJ5xvkpkMUiNancB1a

Num chat novo, o Claude consegue ler estes links diretamente (artifacts teus). Se não conseguir, anexa este zip.

## Conteúdo

| Pasta | O quê |
|---|---|
| `prototipo/cofre-familiar-v28.html` | A app inteira (HTML+CSS+JS, ~210 KB). Fonte de verdade do comportamento e do visual |
| `design/DESIGN-SYSTEM.md` | Tipografia, cores (escuro e claro), cores de dados, espaçamentos, componentes, gráficos |
| `design/tokens.css` | Variáveis CSS `:root` exatamente como no protótipo |
| `design/tokens.json` | Os mesmos tokens em JSON |
| `design/tailwind.preset.js` | Preset Tailwind ligado às variáveis CSS |
| `design/cofre-estilos-completos.css` | Todo o CSS do protótipo, tal e qual |
| `fonts/` | Plus Jakarta Sans 400–800 e JetBrains Mono 500–600 (woff2, licença OFL) |
| `mockups/escuro/`, `mockups/claro/` | 53 capturas: 15 ecrãs desktop por tema, 6 ecrãs de telemóvel por tema, 11 modais |
| `ferramentas/extrato_para_csv.py` | PDF de extrato (Trade Republic + genérico) → CSV importável |
| `ferramentas/bancoinvest_para_csv.py` | "Posição Actual" do Banco Invest (xlsx) → CSV de transações com subcontas |

## Regras de negócio já validadas (não perder)

1. Totais sempre em EUR; cada conta em moeda própria com o valor em EUR entre parênteses. Câmbios: USD 0,92 · GBP 1,17 · CHF 1,06 (editáveis).
2. Moeda definida por portfolio; gráficos e previsão de dividendos na moeda do portfolio.
3. Um ativo (ticker) é único: o preço atualiza-se uma vez para todas as contas e portfolios.
4. Contas com vários titulares; contas de investimento com subcontas (ex.: Banco Invest com Rui, Liliana, Simão, Vicente), cada uma com unidades e custo médio próprios.
5. "Registar liquidez" por conta de investimento: desligado quando se paga por débito direto (PPR); assim as compras não deixam saldo negativo.
6. Vendas e dividendos de contas sem liquidez ficam na liquidez do portfolio até serem movidos para uma conta (com ou sem movimento espelho).
7. Transferências internas (por IBAN ou par de movimentos com o mesmo valor em ±3 dias) não são despesa. Envios para contas próprias fora da app (aliases das pessoas) são despesa; entradas dessas contas são "Reembolsos" (abatem às despesas).
8. Regras de categorias por palavra no início de palavra; o IBAN é a palavra-chave preferida. Ex.: PT50003501350069602273023 = personal trainer (Desporto e ginásio).
9. XTB: dividendos agrupados por símbolo e data, com imposto retido e reembolsos de imposto separados; o cartão da conta mostra brutos, impostos, reembolsos e líquidos.
10. Contas remuneradas e depósitos podem ser incluídos num portfolio (ex.: Trade Republic → Fundo de emergência) sem contar duas vezes no património.
11. Produtos de poupança: TANB, paga juros a cada N meses/dias desde a data da aplicação, prazo, imposto (28% por defeito), juros ficam no depósito (capitalizam) ou vão para uma conta; juro do período = base × TANB × dias/365, líquido do imposto. Juros e capital nos extratos são ligados ao depósito para não contar duas vezes.
12. Agrupamento de contas nos portfolios por "Agrupar como" ou pelo produto; linha de grupo com total e taxa média ponderada.
13. Objetivos: valor, valor investido, rendimento passivo, investir no ano; âmbito por portfolios ou por contas/subcontas; com data limite, sem data (calcula quando atinges) ou só acompanhar.
14. Importadores: BPI xlsx, CSV bancário genérico com coluna de saldo, XTB xlsx, CSV de transações de investimento (com subcontas), Trade Republic via script. Todos idempotentes.

## Valores de referência para testes

- XTB conta 50611139: liquidez 11,25 US$, dividendos brutos 70,75 US$, impostos −10,69 US$, reembolso +4,24 US$, depósitos 1284,39 US$.
- BPI (extrato de 01/09/2026): saldo 3959,43 €.
- Trade Republic: saldo 5285,98 €, juros 12 meses 100,52 €, total 197,38 €.
- Banco Invest (Invest Tendências Globais a 8,017 €): Rui 1234,9144 un. / 9900,31 € · Liliana 596,7909 / 4784,47 € · Simão 504,8609 / 4047,47 € · Vicente 309,5371 / 2481,56 € · total investido 19 066,66 €.

## Mensagem para colar no novo chat

> Estou a construir o Cofre Familiar, uma app de finanças familiares. Em anexo (ou nos links) estão o protótipo v28, o PRD da versão servidor e o kit de design com mockups, tokens e fontes. Lê primeiro `LEIA-ME-HANDOFF.md`, depois `design/DESIGN-SYSTEM.md` e o PRD. O visual e o comportamento têm de ficar exatamente iguais ao protótipo; usa `design/tokens.css` e as capturas em `mockups/` como referência. Começa pela fase 1 do PRD.
