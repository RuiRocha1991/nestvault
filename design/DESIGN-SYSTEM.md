# Cofre Familiar — Sistema de design (v28)

Fonte de verdade: `prototipo/cofre-familiar-v28.html`. O CSS completo está em `design/cofre-estilos-completos.css`
e os tokens em `design/tokens.css`, `design/tokens.json` e `design/tailwind.preset.js`.
Tema escuro por defeito; tema claro via `data-theme="light"` ou `prefers-color-scheme: light`.

## 1. Tipografia

| Uso | Família | Tamanho / peso | Token |
|---|---|---|---|
| Valor principal (hero, património) | Plus Jakarta Sans | 30 / 800 | `--fs-3xl` |
| Título de página (h1) | Plus Jakarta Sans | 24 / 700, letter-spacing −0.01em | `--fs-2xl` |
| Valor de KPI | Plus Jakarta Sans | 20 / 700 | `--fs-xl` |
| Título de cartão | Plus Jakarta Sans | 16 / 600 | `--fs-lg` |
| Texto base | Plus Jakarta Sans | 14 / 400, line-height 1.45 | `--fs-base` |
| Tabelas, botões, navegação | Plus Jakarta Sans | 13 / 500–600 | `--fs-md` |
| Legendas, filtros, notas | Plus Jakarta Sans | 12 / 500 | `--fs-sm` |
| Rótulo em maiúsculas (eyebrow) | Plus Jakarta Sans | 11 / 600, uppercase, letter-spacing 0.08em, cor `--fg-3` | `--fs-xs` |
| Tickers, códigos, IBAN | JetBrains Mono | 12 / 600 | `--mono` |

Números: `font-variant-numeric: tabular-nums` (classe `.num`). Formato pt-PT: `1 234,56 €`, datas `dd/mm/aaaa`.
Valores noutra moeda: `1361,87 US$ (1252,92 €)` com o valor em EUR mais pequeno e em `--fg-3`.

## 2. Cores — interface

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `--bg` | #1A1B38 | #ECECF6 | Fundo da página |
| `--sidebar` | #1F2044 | #FFFFFF | Barra lateral |
| `--panel` | #24264C | #FFFFFF | Cartões, modais |
| `--panel-2` | #2C2E5A | #F4F4FA | Botões secundários, chips, linhas destacadas |
| `--inset` | #1D1F40 | #F0F0F8 | Campos de formulário, áreas rebaixadas |
| `--line` | #33356A | #E3E3F0 | Divisórias |
| `--line-2` | #41447C | #D3D3E6 | Bordas de controlos |
| `--fg` | #F2F2FB | #1C1D3B | Texto principal |
| `--fg-2` | #AEB0D2 | #585A82 | Texto secundário |
| `--fg-3` | #7779A6 | #8B8DB0 | Texto discreto, eixos, rótulos |
| `--accent` | #7C3AED | #7030E8 | Ação principal, item ativo |
| `--accent-2` | #9D6BFF | #8B55F5 | Acento claro, gráficos |
| `--accent-soft` | rgba(124,58,237,.20) | rgba(112,48,232,.10) | Fundos de seleção |
| `--on-accent` | #FFFFFF | #FFFFFF | Texto sobre acento |
| `--pos` | #3CCB7F | #1E9E5E | Ganhos, entradas, "No ritmo" |
| `--neg` | #F25A64 | #D93843 | Perdas, saídas, apagar |
| `--warn` | #F2A63D | #C97A12 | Avisos, "Abaixo do ritmo" |
| `--overlay` | rgba(10,10,30,.62) | rgba(28,29,59,.38) | Fundo dos modais |

Gradientes: `--grad-warm` (90°, #F2913D → #E5424D) para o chip "Todos"; `--grad-violet` (180°, #9D6BFF → #6A2BD9).
Sombra: escuro `0 1px 0 rgba(255,255,255,.03) inset, 0 8px 24px rgba(5,5,25,.25)`; claro `0 1px 2px rgba(30,30,80,.04), 0 6px 20px rgba(30,30,80,.06)`.
Logótipo: "COFRE" em `--c-orange` 800 com "FINANÇAS FAMILIARES" em eyebrow espaçado.

## 3. Cores — dados

Cores base (iguais nos dois temas): laranja #F2913D, vermelho #E5424D, violeta #6C5CFF, azul #3BA7F2,
turquesa #2BC6B4, rosa #E356A8, amarelo #F2C43D, verde #3CCB7F.

Paleta de séries (ordem de atribuição a portfolios, pessoas, objetivos):
#9D6BFF, #F2913D, #3BA7F2, #E5424D, #2BC6B4, #F2C43D, #E356A8, #3CCB7F, #6C5CFF, #FF7A59, #5B8DEF, #8C8FB8.

| Tipo de ativo | Cor | Tipo de conta | Cor | Ícone |
|---|---|---|---|---|
| Ação | #F2913D | À ordem | #3BA7F2 | bank |
| ETF | #9D6BFF | Remunerada | #2BC6B4 | percent |
| Fundo | #5B8DEF | Depósito a prazo | #F2C43D | safe |
| REIT | #E5424D | Corretora | #6C5CFF | trend |
| PPR | #2BC6B4 | | | |
| Obrigação | #C9A227 | | | |
| Cripto | #E356A8 | | | |
| Outro | #8C8FB8 | | | |

Ícones de conta: quadrado 30–36 px, raio 8, fundo = cor do tipo com alpha `2e`, ícone na cor do tipo.

Categorias por defeito: Habitação #6C5CFF · Supermercado #F2913D · Restauração #E356A8 · Transportes #3BA7F2 ·
Combustível #5B8DEF · Utilidades · Telecomunicações #2BC6B4 · Subscrições #9D6BFF · Saúde #3CCB7F · Educação #FF7A59 ·
Seguros #8C8FB8 · Compras #E5424D · Lazer e viagens #F2913D · Desporto e ginásio #3CCB7F · Impostos #8C8FB8 ·
Levantamentos · Comissões bancárias #7779A6 · Outras despesas #8C8FB8 · Salário #3CCB7F · Juros e dividendos #2BC6B4 ·
Outros rendimentos #3BA7F2 · Envios para contas próprias fora da app #C9A227 · Reembolsos #2BC6B4 ·
Transferência interna #7779A6 · Investimento #9D6BFF.

## 4. Espaçamento, raios, layout

- Grelha de 4 px: `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 20 · `--s6` 24 · `--s8` 32 · `--s10` 40.
- Raios: `--r-sm` 6 (controlos) · `--r-md` 8 (cartões) · `--r-lg` 12 (modais) · `--r-pill` 999 (chips).
- Barra lateral 232 px, fixa; em ecrãs ≤ 860 px passa a gaveta (280 px, botão de menu no topo).
- Conteúdo: grelha de 12 colunas, gap 16; gutter 24 (16 no telemóvel). Cartões: padding 16 × 20, gap interno 12.
- Breakpoints usados (max-width): 1180 (KPIs em 2 colunas), 860 (gaveta), 720 (uma coluna).

## 5. Componentes (medidas exatas)

| Componente | Especificação |
|---|---|
| Botão | altura 34, padding 0 14, raio 6, borda `--line-2`, fundo `--panel-2`, texto 13/600 |
| Botão principal | fundo e borda `--accent`, texto `--on-accent` |
| Botão discreto (ghost) | sem fundo nem borda; `.danger` em `--neg` |
| Botão pequeno (`.sm`) | altura 28, padding 0 10, texto 12 |
| Campo | altura 34, raio 6, borda `--line-2`, fundo `--inset`, padding 0 10; foco com anel `--accent` |
| Chip | altura 22, padding 0 9, raio pill, 11/600, fundo `--panel-2`, texto `--fg-2`; variantes `.pos`, `.warn`, `.accent` |
| Segmentado (`.seg`) | grupo de botões com o ativo em `--accent` |
| Separadores (tabs) | texto 13/600 `--fg-3`, ativo `--fg` com sublinhado 2 px `--accent-2` |
| Cartão | fundo `--panel`, raio 8, padding 16 × 20, sombra `--shadow` |
| Tabela | cabeçalho eyebrow, linhas com divisória `--line`, números à direita em tabular-nums |
| Lista chave–valor (`.kv`) | grelha auto / 1fr, 12 px, gap 4 × 16 |
| Barra de progresso | altura 5 (8 em `.thick`), raio 5, fundo `--inset`, preenchimento na cor do item |
| Anel de progresso | 56 px, traço 6, cor do objetivo |
| Modal | largura até 540 (`wide` 760), raio 12, cabeçalho com título e fechar, rodapé com Cancelar + ação |
| Toast | canto inferior direito, fundo escuro, texto 13/600 |
| Chip de portfolio | botão com ponto de cor, nome e valor em `--fg-3`; "Todos" usa `--grad-warm` |

## 6. Gráficos

- Linha suave (bezier com pontos de controlo limitados), área preenchida com gradiente da cor da série até transparente.
- Eixos em `--fg-3`, 10 px; grelha em `--line`; marcador do último ponto com círculo vazado.
- Barras de dividendos: colunas arredondadas, mês atual destacado com `--grad-warm`.
- Donut de alocação e despesas: traço 18, total ao centro, legenda à direita ou por baixo com valor e %.
- Valores nos gráficos na moeda do portfolio (dentro de um portfolio) ou em EUR (visão geral).
