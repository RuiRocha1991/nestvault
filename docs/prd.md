# PRD — Cofre Familiar (versão servidor)

> **Note (2026-10-11):** the "Importadores" design in this PRD is superseded by
> [ADR 0001](adr/0001-ai-assisted-importers.md): parsing moves to an isolated Python parser service
> with automatic format detection and, in a later phase, AI-assisted import specs.

Oct 11, 2026 · @Rui Rocha

## Resumo e objetivos

O Cofre Familiar passa de uma página HTML com armazenamento privado para uma aplicação web multiutilizador em Next.js (Node) com PostgreSQL, separando a base de dados de identidade da base de dados financeira. O protótipo atual (versão 28) é a especificação funcional e visual: tudo o que ele faz tem de continuar a funcionar, agora partilhado entre as pessoas de um agregado (pool).

**Objetivos da v1**

- Várias pessoas entram com conta própria e trabalham sobre os mesmos dados do agregado (pool), em tempo quase real.
- Os dados financeiros ficam isolados por pool em todas as camadas: nenhum pedido lê ou escreve dados de outra pool.
- Paridade funcional com o protótipo: portfolios, subcontas, poupanças com produtos, despesas com regras, objetivos, importadores (BPI, XTB, Trade Republic, Banco Invest, CSV genérico).
- Cotações e câmbios atualizados por um processo agendado (de hora a hora em dias úteis), sem intervenção manual.
- Corre em Render, Vercel ou num VPS com Docker, com a mesma base de código.

**Fora da v1 (fases seguintes)**

- Regras finas por pessoa (ver só certas contas, limites de edição): o modelo de dados fica preparado, a interface vem depois.
- Ligação direta aos bancos (PSD2/open banking).
- App móvel nativa: a v1 é uma web app responsiva, instalável como PWA.
- Faturação e planos pagos.

## Utilizadores, pools e papéis

Uma **pool** é um agregado (ex.: "Família Rocha"); um **utilizador** entra com conta própria e pode pertencer a várias pools; uma **pessoa do agregado** (titular) é um registo financeiro que pode ou não estar ligado a um utilizador. Os filhos são titulares de subcontas sem precisarem de login.

| Conceito | Onde vive | Exemplo |
| --- | --- | --- |
| Utilizador | Base de identidade | rui@…, liliana@…, com palavra-passe e 2FA |
| Pool | Base de identidade | Família Rocha (dona: Rui) |
| Membro da pool | Base de identidade | Liliana, papel Admin |
| Convite | Base de identidade | link com validade de 7 dias para um email |
| Titular (pessoa do agregado) | Base da app | Rui, Liliana, Simão, Vicente; pode apontar para um utilizador |

**Papéis da v1** (fixos; regras finas ficam para a fase 3):

| Permissão | Dono | Admin | Membro | Leitor |
| --- | --- | --- | --- | --- |
| Ver todos os dados da pool | sim | sim | sim | sim |
| Criar e editar movimentos, transações, preços | sim | sim | sim | não |
| Importar extratos | sim | sim | sim | não |
| Gerir contas, portfolios, produtos, categorias | sim | sim | não | não |
| Convidar e remover membros, mudar papéis | sim | sim (exceto donos) | não | não |
| Apagar a pool, transferir propriedade, exportar tudo | sim | não | não | não |

**Preparado para regras (fase 3):** cada permissão é uma string (`accounts.write`, `imports.run`…) verificada por uma única função `can(ctx, permission, resource?)`. Os papéis são conjuntos de permissões; mais tarde junta-se uma tabela `member_rules` com âmbito por conta ou portfolio (ex.: o Simão vê só a sua subconta) sem mudar o código das funcionalidades.

## Requisitos funcionais

Cada módulo replica o comportamento já validado no protótipo; a coluna "Regra de negócio" é o que os testes de domínio têm de garantir.

| Módulo | Funcionalidades | Regra de negócio principal |
| --- | --- | --- |
| Visão geral | Património líquido, investimentos, rendimento passivo, despesas do mês, evolução, objetivos | Totais sempre em EUR; cada conta conta uma só vez, mesmo ligada a um portfolio |
| Portfolios | Resumo estilo Snowball, posições por ativo ou por conta/subconta, dividendos, transações, análise; moeda por portfolio | Custo médio por ativo e conta; TIR por XIRR; ganho total = capital + dividendos brutos − impostos + reembolsos + vendas + juros |
| Ativos e preços | Ativo único por ticker, partilhado por contas e portfolios; histórico de preços | O preço atualiza-se uma vez para todas as contas |
| Contas | À ordem, remunerada, depósito a prazo, corretora; vários titulares; subcontas; IBAN; moeda; liquidez registada ou não; grupo; ligação a portfolio | Saldo na moeda da conta, valor entre parênteses em EUR |
| Poupanças | Produtos (TANB, periodicidade, prazo, imposto, destino dos juros); aplicações com datas próprias; agrupamento | Juro do período = base × TANB × dias/365, líquido do imposto; capitaliza se ficar no depósito |
| Despesas | Movimentos, categorias editáveis, regras por palavra, orçamentos | Transferências internas (IBAN ou par de movimentos) não são despesa; envios para contas próprias fora da app são despesa; entradas dessas contas são reembolso |
| Liquidez de portfolio | Vendas e dividendos sem conta com liquidez ficam no portfolio até serem movidos | Mover para uma conta pode criar o movimento espelho ou não (se vier no extrato) |
| Objetivos | Valor, valor investido, rendimento passivo, investir no ano; âmbito por portfolios ou contas/subcontas; com data, sem data (previsão) ou só acompanhar | Projeção com contribuição mensal e rentabilidade; "investido" sem ganhos |
| Importadores | BPI (xlsx), XTB (xlsx), Trade Republic (PDF), Banco Invest (xlsx por lote), CSV bancário genérico, CSV de transações | Idempotentes: reimportar não duplica (hash ou ID externo) |
| Pools e membros | Criar pool, convidar por email, aceitar convite, mudar papéis, sair, transferir propriedade | Uma pool tem sempre pelo menos um dono |
| Conta de utilizador | Registo, login, 2FA, sessões ativas, mudar palavra-passe, apagar conta, exportar dados | Apagar a conta não apaga a pool se houver outro dono |

## Arquitetura

Um monorepo TypeScript com uma app Next.js 15 (App Router, runtime Node), um worker Node e um pacote de domínio puro. As dependências só descem: a apresentação chama serviços, os serviços usam o domínio e os repositórios, e só os repositórios falam com o Postgres.

&#91;embedded content: camadas da aplicação · 6 camadas, 2 bases, 1 worker\]

A camada de aplicação (destacada) é a única porta de entrada para os dados: tanto as páginas como o worker passam por ela.

**Stack**

| Peça | Escolha | Porquê |
| --- | --- | --- |
| Framework | Next.js 15, React 19, TypeScript estrito | Server Components e Server Actions reduzem a API a manter |
| UI | Tailwind CSS com os tokens do protótipo, componentes shadcn/ui, gráficos em SVG próprio ou Recharts | Reaproveita o design já validado |
| Autenticação | Better Auth (email e palavra-passe, verificação de email, TOTP, sessões em base de dados) | Corre no nosso Postgres, sem serviço externo; alternativa: Auth.js v5 |
| ORM e migrações | Drizzle ORM + drizzle-kit, um esquema e uma pasta de migrações por base | SQL explícito, bom suporte a RLS e `numeric` |
| Validação | zod em todas as entradas (formulários, API, ficheiros) | Um esquema partilhado entre cliente e servidor |
| Fila e jobs | pg-boss | Usa o Postgres que já existe; sem Redis |
| Email | Resend ou SMTP | Convites, verificação, recuperação |
| Ficheiros | S3 compatível (Cloudflare R2) ou disco local no VPS | Originais dos extratos, cifrados |
| Testes | Vitest, Playwright | Domínio, isolamento e fluxos |

**Estrutura de pastas**

```
apps/web/            Next.js: app/(auth), app/(app)/[poolId]/..., middleware.ts
apps/worker/         processos agendados (pg-boss)
packages/domain/     cálculos puros, sem I/O (porta do protótipo)
packages/services/   casos de uso + guardas (requireSession, requirePoolAccess, can)
packages/db/         identity/ e app/: esquemas Drizzle, migrações, repositórios
packages/importers/  um módulo por formato de extrato
packages/ui/         tokens e componentes partilhados
```

**Onde correr**

| Opção | Web | Worker e jobs | Postgres | Quando escolher |
| --- | --- | --- | --- | --- |
| Render (recomendado para começar) | Web Service | Background Worker | Render Postgres (Frankfurt), duas bases na mesma instância | Simples, processos longos e worker permanentes |
| Vercel | Projeto Vercel (Node) | Vercel Cron a chamar rotas protegidas, ou o worker no Render | Neon ou Supabase (UE) | Se quiseres previews por PR; os jobs longos ficam fora da Vercel |
| VPS (Hetzner, por exemplo) | Container `next start` (standalone) | Container worker | Container Postgres com volume e backups para S3 | Custo mais baixo e controlo total; tu tratas de atualizações e backups |

O mesmo `Dockerfile` serve o Render e o VPS; a configuração muda só por variáveis de ambiente (`IDENTITY_DATABASE_URL`, `APP_DATABASE_URL`, `APP_ENCRYPTION_KEY`, `PRICES_API_KEY`, `EMAIL_*`).

## Bases de dados

Duas bases PostgreSQL 16 no mesmo servidor (ou duas instâncias geridas): `cofre_identity` guarda quem é quem e quem pode o quê; `cofre_app` guarda o dinheiro, sempre com `pool_id`. Cada uma tem o seu utilizador de ligação, as suas migrações e o seu backup; a app nunca faz joins entre as duas, só passa IDs (UUID v7).

**Porquê separar:** uma fuga ou um erro na base financeira não expõe hashes de palavras-passe nem sessões; a base de identidade pode ter retenção e backups próprios; apagar um utilizador (RGPD) não mexe nos dados da pool.

**cofre\_identity**

| Tabela | Colunas principais | Notas |
| --- | --- | --- |
| users | id, email (único, citext), name, email\_verified\_at, created\_at, deleted\_at | Sem dados financeiros |
| credentials | user\_id, password\_hash (argon2id), updated\_at | Separada de users |
| two\_factor | user\_id, totp\_secret (cifrado), backup\_codes\_hash, enabled\_at | Segredo cifrado com chave da app |
| sessions | id, user\_id, token\_hash, ip, user\_agent, expires\_at, last\_seen\_at, active\_pool\_id | Revogáveis; cookie só tem o token |
| pools | id, name, base\_ccy (EUR), created\_by, created\_at |  |
| pool\_members | pool\_id, user\_id, role (owner, admin, member, viewer), joined\_at | PK (pool\_id, user\_id) |
| invites | id, pool\_id, email, role, token\_hash, expires\_at, accepted\_at, invited\_by | Uso único, 7 dias |
| member\_rules | id, pool\_id, user\_id, permission, scope\_type, scope\_id, effect | Fase 3 (regras por pessoa) |
| audit\_log | id, pool\_id, user\_id, action, target, ip, at, meta jsonb | Só inserção |

**cofre\_app** (todas com `pool_id uuid not null` e Row-Level Security)

| Tabela | Colunas principais |
| --- | --- |
| holders | id, name, color, aliases\[\], user\_id (opcional) |
| accounts | id, type, name, institution, iban, ccy, opening, opening\_date, track\_cash, group\_name, portfolio\_id, rate, xtb\_account\_no |
| account\_holders | account\_id, holder\_id |
| sub\_accounts | id, account\_id, name, holder\_id |
| savings\_products | id, name, institution, rate, pay\_every\_n, pay\_every\_unit, term\_n, term\_unit, tax\_pct, pay\_to\_account\_id, fund\_from\_account\_id |
| deposits | account\_id (PK), product\_id, capital, start\_date, rate, pay\_every\_*, term\_*, tax\_pct, pay\_to\_account\_id, fund\_from\_account\_id, capitalize |
| transactions | id, account\_id, date, description, amount, category\_id, is\_transfer, pair\_id, kind\_lock, dep\_link, hash, import\_batch\_id |
| categories | id, name, kind (expense, income, refund, transfer, invest), color, monthly\_budget |
| rules | id, keyword, category\_id, account\_id, position |
| interest\_entries | id, account\_id, date, amount, rate, source |
| assets | id, ticker, symbol, name, type, ccy, sector, region, dps, div\_months\[\] |
| asset\_prices | asset\_id, date, price, source (PK asset\_id, date) |
| portfolios | id, name, color, ccy, note, targets jsonb |
| investment\_ops | id, portfolio\_id, asset\_id, account\_id, sub\_account\_id, type, date, qty, price, fee, amount, tax, gross, from\_cash, plan\_id, ext\_id |
| plans | id, portfolio\_id, asset\_id, account\_id, sub\_account\_id, amount, day, active |
| portfolio\_cash\_moves | id, portfolio\_id, account\_id, date, amount, note, transaction\_id |
| goals | id, name, type, target, deadline\_mode, deadline, monthly, rate, yield, color, include\_savings |
| goal\_scopes | goal\_id, scope\_type (portfolio, account, sub\_account), scope\_id |
| fx\_rates | date, ccy, eur\_rate (global, sem pool\_id) |
| import\_batches | id, kind, file\_name, file\_sha256, rows, created\_by, created\_at |

**Regras de dados:** dinheiro em `numeric(18,4)` (nunca float), quantidades em `numeric(20,8)`, datas em `date`; tudo o que é derivado (saldos, posições, juros de depósitos) é calculado no domínio e pode ser guardado em vistas materializadas por pool, refeitas após cada escrita.

## Autenticação e guardas

Nenhum dado financeiro é lido sem cinco verificações em sequência; as guardas 2 a 4 vivem na camada de serviços, por isso valem igual para páginas, Server Actions, API e worker.

&#91;embedded content: guardas de um pedido · 5 verificações, 1 saída de erro por cada\]

A guarda 3 devolve 404 e não 403, para não confirmar que uma pool existe a quem não é membro.

**Contrato no código:** todos os repositórios de `cofre_app` recebem um `PoolContext` que só a guarda 3 consegue criar (tipo opaco). Sem ele, o código nem compila; com ele, cada query leva `where pool_id = ctx.poolId` e corre dentro de uma transação que faz `SET LOCAL app.pool_id`, o que ativa as políticas RLS.

```ts
// packages/services/accounts.ts
export async function updateAccount(input: unknown) {
  const session = await requireSession();                       // guarda 2
  const data = UpdateAccount.parse(input);                      // zod
  const ctx = await requirePoolAccess(session, data.poolId);    // guarda 3 -> PoolContext
  await can(ctx, 'accounts.write', { accountId: data.id });      // guarda 4
  return withPool(ctx, tx => accountsRepo.update(tx, ctx, data)); // guarda 5 (RLS) + auditoria
}
```

| Tema | Regra |
| --- | --- |
| Palavras-passe | argon2id; mínimo 12 caracteres; verificação contra palavras-passe expostas (HIBP, k-anonymity) |
| 2FA | TOTP obrigatório para donos e admins, opcional para os restantes; 10 códigos de recuperação |
| Sessões | Token aleatório de 256 bits no cookie; na base só o hash; 30 dias deslizantes, 12 horas sem 2FA concluído; rodar o token no login e ao mudar de papel |
| Revogação | Lista de sessões ativas no perfil; terminar uma ou todas; mudar a palavra-passe termina as outras |
| CSRF | Server Actions com verificação de origem do Next.js; Route Handlers de escrita exigem o cabeçalho `Origin` igual ao domínio e `SameSite=Lax` |
| Convites | Token de uso único (hash na base), 7 dias, preso ao email convidado; aceitar exige sessão com esse email verificado |
| Pool ativa | Guardada na sessão e no URL (`/[poolId]/...`); o URL manda, a guarda 3 confirma sempre |
| Worker | Corre como utilizador de sistema por pool (`ctx.actor = 'system'`), com as mesmas guardas 3 a 5 e permissões próprias |
| Base de dados | Utilizadores Postgres separados: `identity_rw` só vê `cofre_identity`; `app_rw` só vê `cofre_app`, sem `BYPASSRLS`; migrações com um terceiro utilizador só usado no deploy |

## API, importadores e processos agendados

A interface fala com o servidor por Server Actions (formulários e mutações) e por Route Handlers REST em `/api/v1` (importações, exportações, integrações futuras). Todos os endpoints de dados estão sob `/api/v1/pools/:poolId/…` e passam pelas mesmas guardas.

| Método e rota | Permissão | Para quê |
| --- | --- | --- |
| POST /api/v1/auth/\* | pública, com limite | Registo, login, 2FA, logout, recuperar palavra-passe (biblioteca de auth) |
| GET /api/v1/me | sessão | Utilizador, pools e papéis |
| POST /api/v1/pools | sessão | Criar pool (quem cria fica dono) |
| POST /api/v1/pools/:poolId/invites | members.invite | Convidar por email |
| POST /api/v1/invites/:token/accept | sessão | Aceitar convite |
| GET /api/v1/pools/:poolId/overview | pool.read | Visão geral calculada |
| GET, POST, PATCH, DELETE …/accounts, …/portfolios, …/ops, …/transactions, …/goals | read ou write do recurso | CRUD |
| POST /api/v1/pools/:poolId/imports | imports.run | Recebe o ficheiro, deteta o formato, devolve pré-visualização (sem gravar) |
| POST /api/v1/pools/:poolId/imports/:batchId/commit | imports.run | Grava o lote; idempotente |
| GET /api/v1/pools/:poolId/export | pool.export | Exporta tudo em JSON/CSV |

**Importadores** (módulo `importers/`, um ficheiro por formato, todos com a mesma interface `detect(file) → parse(file) → preview → commit`):

- BPI xlsx, CSV bancário genérico (mapeamento de colunas guardado por conta), XTB xlsx (cash operations + open positions, dividendos com imposto e reembolsos), Banco Invest xlsx (lotes por titular → subcontas), CSV de transações de investimento, Trade Republic PDF (porta do script Python para Node com `pdfjs-dist`, ou um pequeno serviço Python).
- O ficheiro original vai para armazenamento de objetos (S3, R2 ou disco no VPS) com o seu SHA-256; reimportar o mesmo ficheiro é detetado.
- Ficheiros até 10 MB, processados num worker, nunca no pedido HTTP quando passam de 1 MB.

**Processos agendados** (fila `pg-boss` em Postgres, num processo worker separado):

| Processo | Frequência | O que faz |
| --- | --- | --- |
| prices.refresh | de hora a hora, 08:00–22:00 em dias úteis | Pede cotações dos tickers em carteira de todas as pools (um pedido por ticker, não por pool) a um fornecedor (FMP, Alpha Vantage ou Twelve Data) e grava em `asset_prices` |
| fx.refresh | diário, 17:00 | Câmbios de referência do BCE para USD, GBP, CHF |
| deposits.link | após cada importação | Liga juros e capital dos extratos aos depósitos |
| plans.remind | diário, 09:00 | Avisa os investimentos regulares por registar |
| snapshots.daily | diário, 23:30 | Guarda o património por pool para os gráficos de evolução |
| sessions.cleanup | diário | Apaga sessões e convites expirados |

## Workflows e mockups

Há três percursos: o dono cria a pool, os convidados juntam-se a ela por convite, e o uso diário parte sempre da pool ativa.

&#91;embedded content: workflow · dono, convidado e uso diário\]

Na primeira entrada, o dono pode importar o JSON exportado do protótipo atual (botão "Exportar" a acrescentar na v28) e ficar com tudo o que já tem.

**Ecrãs**

Os ecrãs financeiros (visão geral, portfolios, despesas, contas, objetivos, importação) já existem em alta fidelidade no protótipo e são a referência visual: mesmos tokens, tipografia e componentes. Os ecrãs novos são os de conta e de pool; os mockups abaixo definem o conteúdo e a ordem dos elementos.

| Rota | Ecrã | Acesso |
| --- | --- | --- |
| /login, /registar, /recuperar | Autenticação | público |
| /2fa | Código TOTP | sessão parcial |
| /pools | Escolher ou criar pool | sessão |
| /convite/\[token\] | Aceitar convite | público, aceitar exige sessão |
| /\[poolId\]/visao-geral, /portfolios, /despesas, /contas, /objetivos | Ecrãs do protótipo | membro |
| /\[poolId\]/importar | Importação com pré-visualização | imports.run |
| /\[poolId\]/definicoes/membros | Membros, papéis e convites | members.invite |
| /conta | Perfil, palavra-passe, 2FA, sessões, exportar, apagar | sessão |

&#91;embedded content: mockup · entrar, 2FA e escolher pool (telemóvel)\]

Se o utilizador só pertence a uma pool, o terceiro ecrã é saltado e entra direto na visão geral.

&#91;embedded content: mockup · Definições → Membros (desktop)\]

O dono não pode ser removido nem rebaixado por um admin; mudar um papel termina as sessões desse membro naquela pool e fica na auditoria.

## Requisitos não funcionais, segurança e testes

| Área | Requisito |
| --- | --- |
| Desempenho | Visão geral em menos de 300 ms no servidor para uma pool com 20 000 movimentos e 2 000 transações de investimento; cálculos de domínio em memória por pool, com cache invalidada a cada escrita |
| Disponibilidade | 99,5% mensal; backups diários das duas bases com 30 dias de retenção e restauro testado por trimestre |
| Privacidade (RGPD) | Dados alojados na UE (Frankfurt ou Paris); exportar e apagar conta pelo próprio utilizador; registo de acessos administrativos |
| Segredos | Variáveis de ambiente por ambiente; chave de cifra para 2FA e ficheiros importados (`APP_ENCRYPTION_KEY`, rotação suportada) |
| Transporte | HTTPS obrigatório, HSTS, cookies `Secure; HttpOnly; SameSite=Lax` |
| Cabeçalhos | CSP estrita com nonce, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Limites | Login e 2FA: 5 tentativas por 15 min por IP e por email; API: 300 pedidos por minuto por sessão; importações: 20 por hora por pool |
| Observabilidade | Logs JSON com `request_id`, `user_id`, `pool_id` (nunca valores ou IBANs); erros em Sentry; métricas de jobs |
| Acessibilidade | WCAG 2.2 AA; navegação por teclado; tema claro e escuro (tokens do protótipo) |
| Idioma e formatos | Português de Portugal; datas dd/mm/aaaa; números `1 234,56 €`; preparado para i18n |

**Testes (bloqueiam o merge):**

1. Domínio (Vitest): custo médio, XIRR, juros de depósitos por período com imposto, pares de transferências, reembolsos, projeções de objetivos. Os casos reais validados no protótipo entram como fixtures (XTB 1361,87 US$, Banco Invest 21 213,81 €, Trade Republic 5285,98 €).
2. Importadores: um ficheiro anonimizado por formato com o resultado esperado.
3. Isolamento entre pools: para cada rota e cada repositório, um teste que tenta ler e escrever dados de outra pool e tem de falhar (aplicação e RLS).
4. Autenticação: rotas sem sessão devolvem 401 ou redirecionam; papéis sem permissão devolvem 403.
5. End-to-end (Playwright): registo → criar pool → convidar → importar BPI → ver despesas; importar XTB → ver portfolio.

## Plano de entrega e skills recomendadas

A entrega faz-se em quatro fases; cada uma termina com a app em produção e os testes da fase a verde.

1. **Fundações:** monorepo, as duas bases com migrações, autenticação com 2FA, pools, convites, guardas e RLS, testes de isolamento, deploy em staging.
2. **Domínio e dados:** porta do motor de cálculo do protótipo para `packages/domain` com testes, CRUD de contas, portfolios, ativos, transações; visão geral e portfolios; migração dos dados do protótipo (exportar JSON → importar para uma pool).
3. **Importadores e automação:** BPI, XTB, Banco Invest, Trade Republic, CSV; worker com cotações de hora a hora e câmbios; poupanças com produtos e ligação aos extratos.
4. **Objetivos, regras e polimento:** objetivos completos, regras por pessoa (`member_rules`), PWA, exportação, observabilidade e restauro de backups testado.

**Como construir com o mínimo de trabalho manual (Claude Code):**

| Ferramenta ou skill | Para quê neste projeto |
| --- | --- |
| `CLAUDE.md` na raiz | Regras fixas: camadas, "nenhuma query sem PoolContext", formatos de dinheiro, comandos de teste. O Claude lê-o em cada sessão |
| Modo de planeamento + este PRD | Pedir uma fase de cada vez; o plano é aprovado antes de escrever código |
| Hooks (`PostToolUse`) | Correr `pnpm lint && pnpm test --changed` depois de cada edição; impede avançar com testes a vermelho |
| Subagentes | Um para revisão de segurança (guardas, RLS) e outro para testes, com contexto próprio |
| skill **frontend-design** | Ecrãs novos (login, pools, convites) com o mesmo estilo do protótipo |
| skill **webapp-testing** (repositório público de skills da Anthropic) | Testes Playwright end-to-end e capturas para rever a interface |
| skills **xlsx** e **pdf** | Ler os extratos reais e gerar fixtures anonimizadas para os importadores |
| skill **dataviz** | Gráficos de evolução, alocação e dividendos coerentes nos dois temas |
| skill **skill-creator** | Criar skills do próprio projeto (abaixo) para tarefas que se repetem |
| Servidores MCP de Postgres e GitHub | Inspecionar o esquema e os dados de staging; abrir PRs e issues por fase |
| GitHub Action do Claude Code | Rever cada PR contra o `CLAUDE.md` e este PRD |

**Skills do projeto a criar com o skill-creator:** `cofre-dominio` (regras de negócio e casos de teste reais), `novo-importador` (passos e checklist para um banco novo), `rota-protegida` (molde de Server Action ou Route Handler com sessão, pool, permissão, zod e auditoria), `migracao-db` (Drizzle, RLS e teste de isolamento para cada tabela nova).
