# Graph Report - NES-146  (2026-10-30)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 6944 nodes · 24851 edges · 215 communities (198 shown, 17 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 535 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bae1a3e6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 208
- Community 213
- Community 214

## God Nodes (most connected - your core abstractions)
1. `signedIn()` - 258 edges
2. `vitest` - 200 edges
3. `next` - 191 edges
4. `dec` - 176 edges
5. `newId()` - 154 edges
6. `Button()` - 144 edges
7. `readJson()` - 134 edges
8. `next-intl` - 130 edges
9. `toPlain()` - 121 edges
10. `NotFoundError` - 109 edges

## Surprising Connections (you probably didn't know these)
- `SettingsTab` --references--> `Permission`  [EXTRACTED]
  apps/web/src/lib/settings-tabs.ts → packages/services/src/guards/permissions.ts
- `valid()` --calls--> `newId()`  [EXTRACTED]
  tests/db/pool-context.test.ts → packages/db/src/ids.ts
- `account()` --calls--> `newId()`  [EXTRACTED]
  tests/db/savings.repo.integration.test.ts → packages/db/src/ids.ts
- `makeDebit()` --calls--> `newId()`  [EXTRACTED]
  tests/db/works.repo.integration.test.ts → packages/db/src/ids.ts
- `newCaller()` --calls--> `newId()`  [EXTRACTED]
  tests/services/pool-access.integration.test.ts → packages/db/src/ids.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Expense classification flow (rules, transfers, refunds, budgets)** — docs_prototype_cofre_familiar_v28_categorization_rules, docs_prototype_cofre_familiar_v28_internal_transfer_detection, docs_prototype_cofre_familiar_v28_refund_handling, docs_prototype_cofre_familiar_v28_monthly_budgets, docs_prototype_cofre_familiar_v28_savings_rate [EXTRACTED 0.90]
- **Statement and broker import pipelines with dedup** — docs_prototype_cofre_familiar_v28_bank_statement_import, docs_prototype_cofre_familiar_v28_xtb_import, docs_prototype_cofre_familiar_v28_investment_ops_csv_import, docs_prototype_cofre_familiar_v28_import_dedup_hash [EXTRACTED 0.90]
- **Portfolio return engine (average cost, XIRR, profit decomposition, dividends)** — docs_prototype_cofre_familiar_v28_average_cost_holdings, docs_prototype_cofre_familiar_v28_xirr, docs_prototype_cofre_familiar_v28_portfolio_profit_decomposition, docs_prototype_cofre_familiar_v28_dividend_withholding, docs_prototype_cofre_familiar_v28_portfolio_cash [EXTRACTED 0.90]
- **AI-assisted import spec pipeline** — docs_adr_0001_ai_assisted_importers_ai_specs, docs_adr_0001_ai_assisted_importers_spec_parsers, docs_adr_0001_ai_assisted_importers_balance_reconciliation, docs_adr_0001_ai_assisted_importers_promotion_levels [EXTRACTED 0.95]
- **Request guard chain (session, zod, pool access, can, withPool)** — docs_prd_guards_chain, docs_prd_pool_context, docs_prd_can_permissions, docs_security_access_control, docs_security_rls [EXTRACTED 0.95]
- **Market data system** — docs_adr_0002_market_data_providers_provider_interface, docs_adr_0002_market_data_providers_market_tables, docs_adr_0002_market_data_providers_quota_manager, docs_adr_0002_market_data_providers_jobs [EXTRACTED 0.95]
- **Design system foundations** — design_design_system_typography, design_design_system_ui_colors, design_design_system_spacing_layout, design_design_system_components [EXTRACTED 1.00]
- **Shipped statement parsers** — services_parser_readme_banco_invest, services_parser_readme_xtb, services_parser_readme_investment_csv, services_parser_readme_trade_republic, services_parser_readme_bpi, services_parser_readme_generic_pdf [EXTRACTED 1.00]
- **Local development environment setup** — readme_nestvault_setup, docs_dev_setup_guide, docs_dev_setup_services, readme_ssh_tunnel [INFERRED 0.85]
- **Route protection guard chain** — _claude_skills_protected_route_skill_guard_order, _claude_skills_finish_task_skill_route_security_checklist, _claude_skills_db_migration_skill_two_locks_isolation [INFERRED 0.85]
- **Service-layer guard chain** — claude_guard_order, claude_poolcontext_withpool, claude_permissions_roles, docs_testing_isolation_suite [INFERRED 0.85]
- **NestVault task lifecycle skills** — _claude_skills_start_task_skill, _claude_skills_protected_route_skill, _claude_skills_db_migration_skill, _claude_skills_finish_task_skill [INFERRED 0.85]

## Communities (215 total, 17 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (125): accountsRepo, AssetValues, GoalValues, holdersRepo, HolderValues, InvestmentOpValues, InstallmentValues, loansRepo (+117 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (25): createEntitlements(), assertFeature(), assertWithinLimit(), planOf(), PlanLimitError, addInstallment(), create(), ownerOf() (+17 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (50): addMonths(), isIsoDate(), lastMonths(), monthEnd(), monthKey(), monthParts(), monthsBetween(), nextMonths() (+42 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (145): AccountsError(), AccountsLoading(), AuditError(), AuditLoading(), MembersLoading(), dynamic, SearchPage(), ProductsBlock() (+137 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (69): PasswordForm(), onSubmit(), Status, emailSchema, ProfileForm(), onSubmit(), ProfileFormProps, Status (+61 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (58): PoolSwitcher(), BarChart(), BarChartProps, positive(), ChartLegendProps, DonutProps, DonutSegment, clamp() (+50 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (67): _csv_rows(), detect_delimiter(), header_matching(), read_rows(), _xlsx_rows(), UnsupportedFileError, normalize_text(), BrokerRow (+59 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (115): assetPricesRepo, categoriesRepo, depositsRepo, withPool, isUuid(), dueDates(), isDueDate(), occurrenceKey() (+107 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (144): MembersError(), AccountsScreen(), removeInterest(), AccountsScreenProps, Dialog, DeleteDialog(), DeleteTarget, ApplyRulesDialog() (+136 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (57): AccountRow, accountBalance(), AccountKind, LedgerAccount, LedgerData, ManualInterestEntry, Totals, add() (+49 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (75): testEnv(), createIdentityDatabase(), auditLogRepo, usersRepo, verifyEmailWithToken(), createInviteVerifier(), createPoolsService(), createRateLimiter() (+67 more)

### Community 11 - "Community 11"
Cohesion: 0.12
Nodes (42): Field(), FIELD_ICON_CLASS, fieldClass(), PasswordInputProps, AssetDialog(), submit(), CURRENCIES, MONTHS (+34 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (42): assetsRepo, categorySettingsRepo, investmentOpsRepo, poolSettingsRepo, portfolioCashMovesRepo, subAccountsRepo, transactionsRepo, accountBalances() (+34 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (60): PoolsLayout(), dynamic, Heading(), InvitePage(), dynamic, InviteSignupPage(), AuthLayout(), dynamic (+52 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (79): roundCents(), roundTo(), sum(), toPlain(), buildEventSchedule(), defaultEffectiveFrom(), EventScheduleInput, EventScheduleRow (+71 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (83): ADR-0002, CategoryValues, goalsRepo, LoanFieldValues, monthNotesRepo, notesRepo, NoteState, plansRepo (+75 more)

### Community 16 - "Community 16"
Cohesion: 0.08
Nodes (29): item, pool, PoolId, DepositsService, InterestService, ProductsService, Capital, CreateDepositInput (+21 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (73): DropZone(), DropZoneProps, HistoryBlockProps, ImportScreen(), changeAccount(), choose(), confirm(), fail() (+65 more)

### Community 18 - "Community 18"
Cohesion: 0.05
Nodes (39): main(), render(), render_spec(), _balances(), _cell(), _external_id(), _plain(), SpecParser (+31 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (43): create_app(), detect(), invalid_request(), parse(), parse_spec(), parser_error(), parsers(), propose_mapping() (+35 more)

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (79): Executes, lockPoolResource(), AppDb, GLOBAL_CATEGORIES, GLOBAL_CATEGORY_KINDS, GlobalCategoryKind, GlobalCategorySeed, ADR-0004 (+71 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (40): isPasswordBreached(), ACCOUNT_PATHS, accountEmailOf(), AUTH_BASE_PATH, emailOf(), ipBucket(), LimitScope, NO_EMAIL (+32 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (44): PoolId, CashMovesService, DisplayRateDto, OpsService, PlansService, HoldingDto, ViewOpDto, PortfoliosService (+36 more)

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (27): MonthNoteCard(), save(), MonthNoteCardProps, Problem, MonthReviewScreenProps, MonthTimeline(), isMonthNoteDirty(), MONTH_NOTE_MAX (+19 more)

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (66): HttpMethod, accountIn(), assetIn(), Base, cashAccountIn(), cashIn(), cashMoveIn(), categoryIn() (+58 more)

### Community 25 - "Community 25"
Cohesion: 0.04
Nodes (43): packageName, loadPublicEnv(), publicEnv, UnauthorizedError, packageName, CENSOR, createLogger(), logger (+35 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (61): applyRules(), CategoryRule, compactIban(), compile(), compiled, CompiledRules, keywordAtWordStart(), matchesKeyword() (+53 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (48): nextConfig, withNextIntl, dynamic, POST, dynamic, GET, dynamic, GET (+40 more)

### Community 28 - "Community 28"
Cohesion: 0.07
Nodes (52): AccountPage(), dynamic, SessionRowData, SessionsCard(), AuditDetail(), Labels, AuditFiltersBar(), AuditFiltersBarProps (+44 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (45): RFC-9562, IdentityExecutor, AuditCriteria, AuditFilter, AuditRow, MS_AT, NewAuditEntry, COLUMNS (+37 more)

### Community 30 - "Community 30"
Cohesion: 0.07
Nodes (40): DELETE, dynamic, Params, PATCH, dynamic, PATCH, dynamic, GET (+32 more)

### Community 31 - "Community 31"
Cohesion: 0.07
Nodes (46): poolsRepo, sessionsRepo, isUuidV7(), createPoolContext(), FrozenPermissions, ROLES, verifyPassword(), ADMIN (+38 more)

### Community 32 - "Community 32"
Cohesion: 0.06
Nodes (47): DELETE, dynamic, Params, dynamic, GET, Params, POST, dynamic (+39 more)

### Community 33 - "Community 33"
Cohesion: 0.11
Nodes (20): dynamic, FILES, GET, dynamic, GET, dynamic, GET, handle (+12 more)

### Community 34 - "Community 34"
Cohesion: 0.10
Nodes (48): _decode_spec(), template_csv(), make_csv(), bank_rows(), make_spec(), parse(), spec_header(), test_a_balance_that_does_not_follow_is_reported() (+40 more)

### Community 35 - "Community 35"
Cohesion: 0.06
Nodes (39): Params, Pool, PoolId, EventImpact, BUILTIN_LOAN_FIELDS, LoansService, Amount, CreateEventInput (+31 more)

### Community 36 - "Community 36"
Cohesion: 0.07
Nodes (73): AccountCard(), AccountCardProps, BrokerageBody(), InterestBlock(), Kv(), periodText(), Row(), TermBody() (+65 more)

### Community 37 - "Community 37"
Cohesion: 0.05
Nodes (51): db-migration skill, Column conventions (uuid v7, numeric money, pool_id), Repository pattern with PoolContext, Required DB tests (isolation, RLS, injection, precision), RLS policy block with app_current_pool_id(), finish-task skill, Commit and PR policy (new commit per change, squash on OK), Definition of done (7 steps) (+43 more)

### Community 38 - "Community 38"
Cohesion: 0.05
Nodes (52): devDependencies, drizzle-orm@^0.45.4, @nestvault/config@workspace:*, @nestvault/crypto@workspace:*, @nestvault/db@workspace:*, @nestvault/domain@workspace:*, @nestvault/services@workspace:*, @nestvault/ui@workspace:* (+44 more)

### Community 39 - "Community 39"
Cohesion: 0.06
Nodes (46): Cofre Familiar v28 prototype (functional spec), Account grouping and linking accounts to a portfolio, Account types: a ordem, remunerada, prazo, corretora, Allocation by asset/type/sector/region/currency and concentration diagnostics, Asset (ticker, type, sector, region, currency, price history, dividend per unit and months), JSON backup export, restore and schema migration, Bank statement import (CSV/XLS, header and column detection, sign invert, balance fix), Keyword categorization rules (first match wins, manual category preserved) (+38 more)

### Community 40 - "Community 40"
Cohesion: 0.11
Nodes (41): BpiXlsx, GenericPdfLines, default_registry(), sniff(), balances(), bpi_xlsx(), main(), opening_balance() (+33 more)

### Community 41 - "Community 41"
Cohesion: 0.07
Nodes (35): packageName, createEcbProvider(), IndexRateProvider, DEFAULT_EXPIRE_SECONDS, DEFAULT_RETRY, defineJob(), Job, JobDefinition (+27 more)

### Community 42 - "Community 42"
Cohesion: 0.06
Nodes (46): dependencies, @asteasolutions/zod-to-openapi@^9.1.0, autoprefixer@^10.6.1, better-auth@^1.7.7, lucide-react@^1.55.0, @nestvault/config@workspace:*, @nestvault/services@workspace:*, @nestvault/ui@workspace:* (+38 more)

### Community 43 - "Community 43"
Cohesion: 0.07
Nodes (31): AccountId, PoolId, SubAccountId, ACCOUNT_CURRENCIES, ACCOUNT_HOLDERS_MAX, ACCOUNT_TYPES, AccountDto, AccountFields (+23 more)

### Community 44 - "Community 44"
Cohesion: 0.12
Nodes (12): createWorkerPoolRunner(), AppDatabase, createAppDatabase(), fxRatesRepo, MarketRate, FxRateRow, fxRates, applyPoolSetting() (+4 more)

### Community 45 - "Community 45"
Cohesion: 0.08
Nodes (24): data(), fmt(), ler(), main(), escrever(), linha(), num(), sem_acentos() (+16 more)

### Community 46 - "Community 46"
Cohesion: 0.10
Nodes (24): ImportsService, SPEC_MAX_BYTES, Amount, BrokerPreviewDto, CommitImportInput, CommitImportResultDto, Day, GetImportQuery (+16 more)

### Community 47 - "Community 47"
Cohesion: 0.08
Nodes (29): ListQuery, Params, PaymentParams, Pool, Amount, asPhase(), CreatePaymentInput, CreateWorkInput (+21 more)

### Community 48 - "Community 48"
Cohesion: 0.10
Nodes (32): AuthUser, AuthUserResponse, ChangePasswordBody, email, password, SessionResponse, setCookie, SignInBody (+24 more)

### Community 49 - "Community 49"
Cohesion: 0.09
Nodes (31): signIn(), hydrated(), openAccounts(), base(), seedMarch(), send(), signIn(), signIn() (+23 more)

### Community 50 - "Community 50"
Cohesion: 0.08
Nodes (18): NAV_GROUPS, NavGroup, NavItem, NavItemKey, SECTION_PAGES, target, ./src/index.ts, pkg (+10 more)

### Community 51 - "Community 51"
Cohesion: 0.08
Nodes (27): ListQuery, Params, PaymentParams, Pool, TotalsQuery, UpcomingQuery, CostOccurrence, PropertyCostsService (+19 more)

### Community 52 - "Community 52"
Cohesion: 0.15
Nodes (18): authorOf(), createNotesService(), setNote(), NotesService, emptyMonthNote(), ListMonthsQuery, MONTH_NOTE_MAX, MONTH_RANGE_MAX (+10 more)

### Community 53 - "Community 53"
Cohesion: 0.08
Nodes (30): { chromium }, jobs, OUT, tmp, addMonths(), annuity(), avatar(), C (+22 more)

### Community 54 - "Community 54"
Cohesion: 0.09
Nodes (24): AsOf, AssetId, PoolId, AssetsService, ASSET_CURRENCIES, ASSET_TYPES, AssetDto, AssetFields (+16 more)

### Community 55 - "Community 55"
Cohesion: 0.16
Nodes (36): agregado(), AUD, audChip(), AUDIT_ROWS, auditFilters(), auditFoot(), auditoria(), auditTable() (+28 more)

### Community 56 - "Community 56"
Cohesion: 0.06
Nodes (33): appUrl, concrete(), differentDatabases(), encryptionKey, ENV_KEYS, EnvIssue, EnvSource, LOCAL_HOSTS (+25 more)

### Community 57 - "Community 57"
Cohesion: 0.12
Nodes (25): HolderId, PoolId, createHoldersService(), assertMember(), HoldersService, HOLDER_PALETTE, nextHolderColor(), Alias (+17 more)

### Community 58 - "Community 58"
Cohesion: 0.09
Nodes (16): converter(), fmt(), num(), parse_generico(), parse_trade_republic(), pdf_para_texto(), container(), docker() (+8 more)

### Community 59 - "Community 59"
Cohesion: 0.21
Nodes (14): RememberedParser, AUTO_CONFIDENCE, AUTO_GAP, DetectInput, DetectOutcome, NeedsChoice, NeedsMapping, ParsedFile (+6 more)

### Community 60 - "Community 60"
Cohesion: 0.05
Nodes (72): CashMoveMatch, CashMoveMatchOptions, cashShortfall(), centsKey(), matchCashMoves(), moveAmountInAccountCurrency(), PendingCashMove, compare() (+64 more)

### Community 61 - "Community 61"
Cohesion: 0.05
Nodes (30): poolMembersRepo, AccountsService, AuditService, AuthRuntime, EntitlementsService, InvitesService, MembersService, MonthsService (+22 more)

### Community 62 - "Community 62"
Cohesion: 0.06
Nodes (40): NoteSheet(), onKeyDown(), save(), NoteSheetProps, NoteText(), OverviewScreenProps, firstLine(), isDirty() (+32 more)

### Community 63 - "Community 63"
Cohesion: 0.12
Nodes (46): accountBalancesAt(), operationEffect(), daysBetween(), dec, addPeriod(), annualRate(), CAPITAL_TOLERANCE, capitalizedInterest() (+38 more)

### Community 64 - "Community 64"
Cohesion: 0.06
Nodes (35): scripts, build, db:check, db:down, db:generate:app, db:generate:identity, db:migrate, db:psql:app (+27 more)

### Community 65 - "Community 65"
Cohesion: 0.08
Nodes (25): PoolTx, DepositValues, BatchHistoryRow, CommittedBatch, importBatchesRepo, ImportBatchValues, interestEntriesRepo, InterestEntryValues (+17 more)

### Community 66 - "Community 66"
Cohesion: 0.10
Nodes (23): Params, PoolId, PropertiesService, Address, Amount, CostsInput, CreatePropertyInput, CreateValuationInput (+15 more)

### Community 67 - "Community 67"
Cohesion: 0.15
Nodes (33): card(), dmy(), donut(), eur(), eurS(), my(), num(), pct() (+25 more)

### Community 68 - "Community 68"
Cohesion: 0.07
Nodes (33): dependencies, drizzle-orm@~0.45.4, @nestvault/config@workspace:*, pg@^8.23.1, pg-boss@12.38.0, tsx@^4.23.15, uuid@^14.0.3, devDependencies (+25 more)

### Community 69 - "Community 69"
Cohesion: 0.09
Nodes (31): StartOptions, Persona, keyOf(), Negative, POOL_ROUTES, USER_ROUTES, Def, defOf() (+23 more)

### Community 70 - "Community 70"
Cohesion: 0.11
Nodes (12): DetectResult, ParserInfo, Parser, Registry, Malformed, stub_registry(), Fixture, _matrix() (+4 more)

### Community 71 - "Community 71"
Cohesion: 0.13
Nodes (14): BankRow, _matches(), euro_amounts(), euro_to_decimal(), money(), pdf_to_text(), strip_euro(), classify() (+6 more)

### Community 72 - "Community 72"
Cohesion: 0.11
Nodes (33): AccountValues, CategorySettingsValues, GoalScopeValue, GOAL_MODES, GOAL_TYPES, isValidIban(), normalizeIban(), ValidationIssue (+25 more)

### Community 73 - "Community 73"
Cohesion: 0.06
Nodes (46): ACCOUNT_AUDIT_ACTIONS, AccountAuditAction, actionsOfCategory(), AUDIT_ACTIONS, AUDIT_CATEGORIES, AuditAction, AuditCategory, POOL_AUDIT_ACTIONS (+38 more)

### Community 74 - "Community 74"
Cohesion: 0.10
Nodes (22): AppLayout(), dynamic, VerifyEmailPendingPage(), SessionWatcher(), authChannel(), loginUrl(), NEXT_PATH_HEADER, buildCsp() (+14 more)

### Community 75 - "Community 75"
Cohesion: 0.08
Nodes (31): dependencies, better-auth@^1.7.7, @nestvault/crypto@workspace:*, @nestvault/db@workspace:*, @nestvault/domain@workspace:*, @node-rs/argon2@^2.2.2, nodemailer@^10.1.0, pino@^10.4.0 (+23 more)

### Community 76 - "Community 76"
Cohesion: 0.15
Nodes (23): _assemble(), _escape(), _escape_cp1252(), make_layout_pdf(), _at(), euro(), Move, _movement_lines() (+15 more)

### Community 77 - "Community 77"
Cohesion: 0.08
Nodes (27): DELETE, dynamic, Params, PATCH, DELETE, dynamic, Params, PUT (+19 more)

### Community 78 - "Community 78"
Cohesion: 0.09
Nodes (29): dependencies, @nestvault/config@workspace:*, @nestvault/db@workspace:*, @nestvault/services@workspace:*, pg@^8.23.1, pg-boss@12.38.0, tsx@^4.23.15, zod@^4.6.6 (+21 more)

### Community 79 - "Community 79"
Cohesion: 0.14
Nodes (25): AuditPage(), dynamic, dynamic, MonthsPage(), AUDIT_PAGE_SIZE, auditQuery(), AuditRange, AuditVocabulary (+17 more)

### Community 80 - "Community 80"
Cohesion: 0.19
Nodes (20): dynamic, GoalsPage(), AllPortfoliosPage(), dynamic, dynamic, OnePortfolioPage(), PortfoliosPage(), PortfoliosPageProps (+12 more)

### Community 81 - "Community 81"
Cohesion: 0.14
Nodes (21): env, migratorEnv(), orExit(), runtimeEnv(), seedEnv(), workerEnv(), Env, EnvValidationError (+13 more)

### Community 82 - "Community 82"
Cohesion: 0.09
Nodes (50): PoolRunner, IdentityDatabase, poolSubscriptionsRepo, Plan, PLANS, AccountsServiceDeps, AssetsServiceDeps, Auth (+42 more)

### Community 83 - "Community 83"
Cohesion: 0.14
Nodes (25): createAuth(), AuthRuntimeConfig, createMemoryEmailSender(), MemoryEmailSender, createSmtpSender(), LOOPBACK, SmtpConfig, EmailContent (+17 more)

### Community 84 - "Community 84"
Cohesion: 0.17
Nodes (16): createInvitesService(), sendInvite(), ADR-0003, AcceptInviteDto, CreateInviteInput, InviteDto, InviteListDto, InvitePreviewDto (+8 more)

### Community 85 - "Community 85"
Cohesion: 0.13
Nodes (35): GoalCard(), GoalDialog(), submit(), GoalScopeOptions, DeleteGoalDialog(), Dialog, GoalsScreen(), GoalsScreenProps (+27 more)

### Community 86 - "Community 86"
Cohesion: 0.15
Nodes (19): PoolId, RuleId, TransactionId, createRulesService(), assertTargets(), invalid(), RulesService, ApplyRulesDto (+11 more)

### Community 87 - "Community 87"
Cohesion: 0.17
Nodes (18): main(), banco_invest_xlsx(), lots_for(), workbook_rows(), _parse(), _rows(), test_a_redemption_is_a_sell_with_positive_cash(), test_a_workbook_without_lots_fails() (+10 more)

### Community 88 - "Community 88"
Cohesion: 0.18
Nodes (16): bytesOf(), CryptoError, decrypt(), encrypt(), header(), isEncryptedWith(), keyIdOf(), KeyRing (+8 more)

### Community 89 - "Community 89"
Cohesion: 0.15
Nodes (16): AccountService, createAccountService(), current(), maskIp(), MeDto, MeWithPoolsDto, NAME_MAX_LENGTH, RevokedSessionsDto (+8 more)

### Community 90 - "Community 90"
Cohesion: 0.09
Nodes (27): dependencies, class-variance-authority@^0.7.1, clsx@^2.1.1, lucide-react@^1.55.0, @radix-ui/react-dialog@^1.2.0, @radix-ui/react-tabs@^1.1.22, react@^19.3.0, react-dom@^19.3.0 (+19 more)

### Community 91 - "Community 91"
Cohesion: 0.12
Nodes (19): test_docs_endpoints_are_not_served(), test_health_needs_no_secret(), test_missing_secret_is_401(), test_secret_shorter_than_32_characters_cannot_start_the_service(), test_the_right_secret_is_accepted(), test_wrong_secret_is_401(), test_detect_below_threshold_returns_nothing(), test_detect_csv_in_latin1() (+11 more)

### Community 92 - "Community 92"
Cohesion: 0.11
Nodes (19): GoalsService, Amount, Color, CreateGoalInput, Decimal, Fields, GOAL_SCOPES_MAX, GoalAccountScope (+11 more)

### Community 93 - "Community 93"
Cohesion: 0.18
Nodes (17): AccountLayout(), generateMetadata(), PoolLayout(), dynamic, NewPoolPage(), dynamic, PoolsPage(), AppFrame() (+9 more)

### Community 94 - "Community 94"
Cohesion: 0.10
Nodes (26): seedOwner(), @playwright/test, fixture, inviteByApi(), fixture, signIn(), BACKGROUND, fixture (+18 more)

### Community 95 - "Community 95"
Cohesion: 0.06
Nodes (46): dynamic, POST, dynamic, GET, DELETE, dynamic, Params, PATCH (+38 more)

### Community 96 - "Community 96"
Cohesion: 0.38
Nodes (9): AccountsPage(), dynamic, dynamic, ImportPage(), asPoolMember(), getAccountsScreen, getPortfolioList, getSavingsProducts (+1 more)

### Community 97 - "Community 97"
Cohesion: 0.17
Nodes (15): bankFile(), brokerSetup(), CSV, holderId(), makeAccount(), poolContext(), preview(), start() (+7 more)

### Community 98 - "Community 98"
Cohesion: 0.06
Nodes (39): Count, ImportCountsDto, ImportResultDto, ImportWarningDto, ExistingHolder, ImportCounts, PlanInput, ADDED_BY_VERSION (+31 more)

### Community 99 - "Community 99"
Cohesion: 0.23
Nodes (19): cash_rows(), _op(), workbook(), xtb_xlsx(), _parse(), _rows(), _sum(), test_a_report_without_operations_fails() (+11 more)

### Community 100 - "Community 100"
Cohesion: 0.13
Nodes (17): dynamic, POST, DELETE, dynamic, dynamic, GET, Params, POST (+9 more)

### Community 101 - "Community 101"
Cohesion: 0.13
Nodes (17): CategoryId, PoolId, ADR-0004, CategoriesService, read(), Budget, CATEGORY_KINDS, CategoryDto (+9 more)

### Community 102 - "Community 102"
Cohesion: 0.27
Nodes (9): UnsupportedMediaTypeError, contentKindOf(), EXTENSIONS, looksLikeText(), looksLikeWorkbook(), sniffUpload(), startsWith(), workbook() (+1 more)

### Community 103 - "Community 103"
Cohesion: 0.25
Nodes (21): alert(), mChangeRole(), mDelete(), mDeletePool(), mInvite(), mLeaveBlocked(), mLeavePool(), mRemoveMember() (+13 more)

### Community 104 - "Community 104"
Cohesion: 0.11
Nodes (20): dependencies, @nestvault/crypto@workspace:*, server-only@^0.0.1, zod@^4.6.6, exports, ./node, ./public, ./schema (+12 more)

### Community 105 - "Community 105"
Cohesion: 0.11
Nodes (23): GlobalCategoryInfo, holder(), household(), overview(), service(), TODAY, inPool(), tableCounts() (+15 more)

### Community 106 - "Community 106"
Cohesion: 0.17
Nodes (14): Month, PoolId, ExpensesService, CategoryExpenseDto, ExpensesSummaryDto, ExpensesSummaryQuery, ExpensesUsageDto, Flag (+6 more)

### Community 107 - "Community 107"
Cohesion: 0.10
Nodes (19): baseRestrictions, configNodeImport, dbImport, noJsxTernaryNull, noJsxText, noJsxTextAttribute, noPoolContextAngleCast, noPoolContextCast (+11 more)

### Community 108 - "Community 108"
Cohesion: 0.10
Nodes (27): convertCurrency(), fromEur(), ResolvedFxRate, allocationBy(), AllocationSlice, Diagnostic, DiagnosticCode, DiagnosticsAttributes (+19 more)

### Community 109 - "Community 109"
Cohesion: 0.15
Nodes (15): DELETE, dynamic, GET, Params, PATCH, dynamic, GET, Params (+7 more)

### Community 110 - "Community 110"
Cohesion: 0.19
Nodes (15): dynamic, SettingsPage(), ParametersCardProps, buildPatch(), FX_CURRENCIES, FxCurrency, FxRateView, FxSource (+7 more)

### Community 111 - "Community 111"
Cohesion: 0.12
Nodes (18): dynamic, POST, DELETE, dynamic, GET, Params, dynamic, GET (+10 more)

### Community 112 - "Community 112"
Cohesion: 0.16
Nodes (10): BucketDefinition, OnLimiterError, RATE_LIMIT_BUCKETS, RateLimitBucket, getClientIp(), isIp(), UNTRUSTED_CLIENT_KEY, Hit (+2 more)

### Community 113 - "Community 113"
Cohesion: 0.16
Nodes (14): diff, example, examplePath, local, localPath, root, describeDiff(), diffEnv() (+6 more)

### Community 114 - "Community 114"
Cohesion: 0.28
Nodes (16): dynamic, ExpensesPage(), SearchParams, filtersToApiQuery(), isMonth(), one(), parseFilters(), parseTab() (+8 more)

### Community 115 - "Community 115"
Cohesion: 0.12
Nodes (24): Amount, CreateTransactionInput, CURSOR_VALUE, CursorBody, decodeCursor(), Description, encodeCursor(), Flag (+16 more)

### Community 116 - "Community 116"
Cohesion: 0.11
Nodes (27): accountEur(), accountMatches(), atLeastZero(), contributionGoal(), DEFAULT_YIELD, EPSILON, futureValue(), Goal (+19 more)

### Community 117 - "Community 117"
Cohesion: 0.12
Nodes (17): with, cache, cache-dependency-glob, check_name, detailed_summary, enable-cache, fail_on_failure, fetch-depth (+9 more)

### Community 118 - "Community 118"
Cohesion: 0.12
Nodes (16): compilerOptions, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noEmit (+8 more)

### Community 119 - "Community 119"
Cohesion: 0.29
Nodes (13): ImportPrototypeCard(), onPick(), send(), ImportPrototypeCardProps, COUNT_KEYS, CountKey, ImportAnswer, ImportProblem (+5 more)

### Community 120 - "Community 120"
Cohesion: 0.12
Nodes (16): PARSER_SECRET, build, cap_drop, cpus, environment, image, mem_limit, memswap_limit (+8 more)

### Community 121 - "Community 121"
Cohesion: 0.15
Nodes (10): installJobQueues(), JOB_SCHEMA, migrateOne(), MIGRATIONS_FOLDERS, MigrationTargets, runMigrations(), resolve, serverOnlyStub (+2 more)

### Community 122 - "Community 122"
Cohesion: 0.25
Nodes (13): API_ROOT, compareWithRegistry(), exportedMethods(), HandlerOnDisk, HTTP_METHODS, listHandlers(), pathOfDir(), RouteFile (+5 more)

### Community 123 - "Community 123"
Cohesion: 0.19
Nodes (12): DELETE, dynamic, GET, Params, PATCH, dynamic, GET, Params (+4 more)

### Community 124 - "Community 124"
Cohesion: 0.08
Nodes (21): ForbiddenError, body(), category(), create(), makeAccount(), seed(), three(), consume (+13 more)

### Community 125 - "Community 125"
Cohesion: 0.19
Nodes (12): DELETE, dynamic, GET, Params, PATCH, dynamic, Params, POST (+4 more)

### Community 126 - "Community 126"
Cohesion: 0.13
Nodes (14): compilerOptions, allowJs, esModuleInterop, incremental, jsx, lib, paths, plugins (+6 more)

### Community 127 - "Community 127"
Cohesion: 0.11
Nodes (19): Automatic format detection (confidence), Code parsers, Python parser service (isolated), Estimated dividend forecast, Euribor index rates (ECB) addendum, Market data jobs (prices, dividends, instruments sync), Global market tables, MarketDataProvider interface (+11 more)

### Community 128 - "Community 128"
Cohesion: 0.08
Nodes (6): etf(), auditOf(), auditActions(), table(), auditEntries(), rows()

### Community 129 - "Community 129"
Cohesion: 0.21
Nodes (11): DELETE, dynamic, GET, Params, PATCH, dynamic, GET, POST (+3 more)

### Community 130 - "Community 130"
Cohesion: 0.26
Nodes (10): SettingsTabs(), SettingsTabsProps, SETTINGS_TABS, settingsPath(), SettingsTab, SettingsTabKey, entry(), filters (+2 more)

### Community 131 - "Community 131"
Cohesion: 0.16
Nodes (13): auditUrl(), hydrated(), openAudit(), signInAs(), openPool(), tabs(), AUDIT_PASSWORD, AuditWorld (+5 more)

### Community 132 - "Community 132"
Cohesion: 0.23
Nodes (14): AuditLayout(), dynamic, MembersPage(), dynamic, MonthReviewPage(), SettingsHeader(), isMonthSegment(), isPoolSegment() (+6 more)

### Community 133 - "Community 133"
Cohesion: 0.09
Nodes (28): Global and custom categories (ADR 0004), Prototype v28 (functional/visual spec), Statement import via parser service (ADR 0001), Validated business rules (14), Category rules by word prefix and IBAN, Savings deposit interest (TANB, tax 28%), Multi-currency totals in EUR with FX rates, Goals (value, invested, passive income, deadline) (+20 more)

### Community 134 - "Community 134"
Cohesion: 0.12
Nodes (18): Definition of done checklist, Git workflow (Jira key branches, PR to dev), Market data providers (ADR 0002), NestVault family finance app (project rules), Notes and monthly review, Plans: Free and Pro (assertWithinLimit/assertFeature), Project skills (.claude/skills), Real estate and loans (Pro, phase 6) (+10 more)

### Community 135 - "Community 135"
Cohesion: 0.18
Nodes (13): Non-functional requirements and limits, Security baseline (21 controls), Encryption at rest (AES-256-GCM), Mass assignment control (strict zod), Parameterized queries control, Password hashing (argon2id), Prototype JSON import (NES-47), Rate limiting control (+5 more)

### Community 136 - "Community 136"
Cohesion: 0.15
Nodes (12): concurrency, cancel-in-progress, group, jobs, secrets, name, permissions, checks (+4 more)

### Community 137 - "Community 137"
Cohesion: 0.17
Nodes (12): dependencies, decimal.js@10.6.0, main, name, private, scripts, build, typecheck (+4 more)

### Community 138 - "Community 138"
Cohesion: 0.24
Nodes (9): dynamic, GET, PATCH, DELETE, dynamic, DELETE, dynamic, GET (+1 more)

### Community 139 - "Community 139"
Cohesion: 0.21
Nodes (12): Persistent DB sessions, pnpm db:check isolation verification, Postgres roles (identity_rw, app_rw, worker_rw, migrator), Environment versions (env-version table), Development setup guide, Local services (Postgres, Mailpit, Parser), Staying signed in (persistent session cookie, APP_URL), pnpm commands table (+4 more)

### Community 140 - "Community 140"
Cohesion: 0.17
Nodes (11): image, ports, restart, name, networks, parser-internal, internal, services (+3 more)

### Community 141 - "Community 141"
Cohesion: 0.26
Nodes (9): Decimal, OVERVIEW_MAX_MONTHS, OVERVIEW_RANGES, OverviewCategoryDto, OverviewDto, OverviewGoalDto, OverviewPortfolioDto, OverviewQuery (+1 more)

### Community 142 - "Community 142"
Cohesion: 0.17
Nodes (11): allowBuilds, esbuild, @parcel/watcher, @scarf/scarf, @swc/core, unrs-resolver, auditConfig, ignoreGhsas (+3 more)

### Community 143 - "Community 143"
Cohesion: 0.13
Nodes (17): DELETE, dynamic, GET, Params, PATCH, dynamic, POST, DELETE (+9 more)

### Community 144 - "Community 144"
Cohesion: 0.27
Nodes (9): DELETE, dynamic, GET, Params, PATCH, dynamic, GET, POST (+1 more)

### Community 145 - "Community 145"
Cohesion: 0.25
Nodes (9): DELETE, dynamic, Params, PATCH, dynamic, GET, POST, search() (+1 more)

### Community 146 - "Community 146"
Cohesion: 0.18
Nodes (10): minor-and-patch, update-types, interval, updates, directory, groups, open-pull-requests-limit, package-ecosystem (+2 more)

### Community 147 - "Community 147"
Cohesion: 0.18
Nodes (10): exports, main, name, private, scripts, build, typecheck, type (+2 more)

### Community 148 - "Community 148"
Cohesion: 0.29
Nodes (7): ALL_KEYS, VALID_ENV, VALID_MIGRATOR_ENV, VALID_TEST_ENV, VALID_WORKER_ENV, without(), messageFor()

### Community 149 - "Community 149"
Cohesion: 0.27
Nodes (8): DELETE, dynamic, Params, dynamic, GET, Params, POST, getCashMovesService()

### Community 150 - "Community 150"
Cohesion: 0.13
Nodes (17): WorksPaymentValues, WorksProjectValues, worksRepo, PAYMENT_STATUSES, PaymentStatus, WORK_STATUSES, WorksPaymentRow, worksPayments (+9 more)

### Community 151 - "Community 151"
Cohesion: 0.20
Nodes (10): interval, retries, test, timeout, healthcheck, image, ports, restart (+2 more)

### Community 152 - "Community 152"
Cohesion: 0.19
Nodes (14): SectionPage(), OverviewHeader(), OverviewHeaderProps, HolderChip, PageHeaderContext, PageHeaderData, usePageHeader(), AppShellProps (+6 more)

### Community 153 - "Community 153"
Cohesion: 0.20
Nodes (17): assertRefs(), assertTerms(), BUILTIN_LABELS, createLoansService(), customAmounts(), installmentDto(), one(), view() (+9 more)

### Community 154 - "Community 154"
Cohesion: 0.36
Nodes (10): steps, steps, steps, steps, steps, id, if, name (+2 more)

### Community 155 - "Community 155"
Cohesion: 0.15
Nodes (13): dynamic, GET, Params, PUT, dynamic, GET, dynamic, Params (+5 more)

### Community 156 - "Community 156"
Cohesion: 0.24
Nodes (7): api(), dropFile(), fixture(), Format, FORMATS, seedAccount(), signIn()

### Community 157 - "Community 157"
Cohesion: 0.12
Nodes (14): Fetch, INDEX_RATE_INDEXES, IndexRateIndex, IndexRatePoint, parseEcbResponse(), ResponseSchema, SERIES, BACKFILL_FROM (+6 more)

### Community 158 - "Community 158"
Cohesion: 0.33
Nodes (6): args, limitIndex, pool, formatRuns(), lastRuns(), RunRow

### Community 159 - "Community 159"
Cohesion: 0.28
Nodes (8): Service guard order (session, zod, requirePoolAccess, can, withPool+audit), Permission strings and roles, Pool (household) data isolation, PoolContext and withPool (RLS), Two databases: nestvault_identity and nestvault_app, expectIsolated helper, Pool isolation and authorization suite (route registry), Invites, members and roles flow

### Community 160 - "Community 160"
Cohesion: 0.22
Nodes (9): parser, condition, command, depends_on, image, networks, ports, restart (+1 more)

### Community 161 - "Community 161"
Cohesion: 0.13
Nodes (12): Balance reconciliation, import_specs table, Spec promotion levels (draft, verified, global), Spec parsers and spec engine, Licensing gate (commercialUse), BILLING_ENABLED flag, Entitlements module (assertWithinLimit, assertFeature), Free preview of Pro modules (demo data) (+4 more)

### Community 162 - "Community 162"
Cohesion: 0.15
Nodes (16): can(ctx, permission) permission strings, Data rules (numeric money, dates, derived in domain), Delivery phases, Five-step guard chain, Layered architecture (presentation, services, domain, repositories), PRD Cofre Familiar (server version), Pool (household) and roles, PoolContext and withPool (+8 more)

### Community 163 - "Community 163"
Cohesion: 0.22
Nodes (8): compilerOptions, jsx, lib, paths, extends, include, ./tsconfig.base.json, @webapp/*

### Community 164 - "Community 164"
Cohesion: 0.20
Nodes (13): Currency, DEFAULT_SETTINGS, ForeignCurrency, FX_OVERRIDES_MAX, FxQuery, FxRateDto, Percent, plain() (+5 more)

### Community 165 - "Community 165"
Cohesion: 0.36
Nodes (8): chip(), conta(), memberRow(), membros(), roleSel(), sessionRow(), pagebar(), definicoesUtilizadores()

### Community 166 - "Community 166"
Cohesion: 0.29
Nodes (7): Auth test helpers (auth-harness), CI workflow security.yml, Test factories (createUser, createPool, asMember), Testing guide, JUnit reports attached to Jira issue, Test layers (unit, integration, e2e), Parser service tests (pytest, detection matrix, shared vectors)

### Community 167 - "Community 167"
Cohesion: 0.25
Nodes (8): run, parser, defaults, if, name, needs, runs-on, working-directory

### Community 168 - "Community 168"
Cohesion: 0.25
Nodes (8): BASE_REF, BRANCH, EVENT, GITHUB_TOKEN, JIRA_API_TOKEN, JIRA_BASE_URL, JIRA_USER_EMAIL, env

### Community 169 - "Community 169"
Cohesion: 0.09
Nodes (27): forEachPool(), lazyOnce(), neverCalled(), valid(), isolationProbe, makeProbeRepo(), PROBE_TABLE_SQL, ProbeInput (+19 more)

### Community 170 - "Community 170"
Cohesion: 0.20
Nodes (12): hashSessionToken(), hashWhere(), isTokenFilter(), plaintextTokenOf(), Row, withHashedSessionTokens(), wrapSessionOps(), hashed() (+4 more)

### Community 171 - "Community 171"
Cohesion: 0.29
Nodes (7): APP_RW_PASSWORD, IDENTITY_RW_PASSWORD, MIGRATOR_PASSWORD, POSTGRES_PASSWORD, POSTGRES_USER, WORKER_RW_PASSWORD, environment

### Community 172 - "Community 172"
Cohesion: 0.15
Nodes (12): json-schema-to-zod@^2.8.1, prettier@^3.9.10, json-schema-to-zod, prettier, body, document, inline(), Json (+4 more)

### Community 173 - "Community 173"
Cohesion: 0.29
Nodes (7): name, outputs, runs-on, changes, code, e2e, parser

### Community 174 - "Community 174"
Cohesion: 0.29
Nodes (5): eslint@^10.12.0, typescript-eslint@^8.71.1, eslint, typescript-eslint, eslint

### Community 175 - "Community 175"
Cohesion: 0.24
Nodes (9): DELETE, dynamic, GET, Params, PATCH, dynamic, GET, POST (+1 more)

### Community 176 - "Community 176"
Cohesion: 0.29
Nodes (6): compilerOptions, jsx, lib, extends, include, ../../tsconfig.base.json

### Community 177 - "Community 177"
Cohesion: 0.20
Nodes (9): ADR-0001, candidateSchema, detectSchema, errorSchema, importSpecSchema, ParserClientOptions, proposalSchema, specSchema (+1 more)

### Community 178 - "Community 178"
Cohesion: 0.47
Nodes (9): account(), asset(), createOp(), holder(), planSetup(), portfolio(), setup(), xtb() (+1 more)

### Community 179 - "Community 179"
Cohesion: 0.21
Nodes (6): filters, servers, setup(), prepareTestDatabases(), loadLocalEnv(), globalSetup()

### Community 180 - "Community 180"
Cohesion: 0.40
Nodes (5): if, name, needs, runs-on, checks

### Community 181 - "Community 181"
Cohesion: 0.40
Nodes (5): if, name, needs, runs-on, e2e

### Community 182 - "Community 182"
Cohesion: 0.40
Nodes (5): on, pull_request, push, workflow_dispatch, branches

### Community 183 - "Community 183"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 184 - "Community 184"
Cohesion: 0.70
Nodes (4): fail(), pass(), db-check.sh script, sql()

### Community 185 - "Community 185"
Cohesion: 0.29
Nodes (5): category(), create(), makeAccount(), seedList(), withRules()

### Community 186 - "Community 186"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 187 - "Community 187"
Cohesion: 0.33
Nodes (6): dynamic, dynamic, OverviewPage(), parseRange(), getHolders, getOverview

### Community 188 - "Community 188"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 189 - "Community 189"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 190 - "Community 190"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 191 - "Community 191"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 192 - "Community 192"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 195 - "Community 195"
Cohesion: 0.36
Nodes (4): candidateOf(), detectAndParse(), isFileRefusal(), ParserClient

### Community 199 - "Community 199"
Cohesion: 0.25
Nodes (7): Amount, MonthCategoryDto, MonthOperationDto, MonthOperationsDto, NOTABLE_REASONS, NotableTransactionDto, TimelineMonthDto

### Community 200 - "Community 200"
Cohesion: 0.32
Nodes (3): account(), holder(), setup()

### Community 201 - "Community 201"
Cohesion: 0.57
Nodes (6): account(), deposit(), fixture(), holder(), ownerOf(), product()

### Community 213 - "Community 213"
Cohesion: 0.60
Nodes (4): account(), holder(), ownerOf(), portfolio()

## Knowledge Gaps
- **100 isolated node(s):** `ADR-0004`, `ADR-0003`, `../../tsconfig.base.json`, `ADR-0002`, `ADR-0004` (+95 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1887 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Community 25` to `Community 0`, `Community 128`, `Community 2`, `Community 1`, `Community 3`, `Community 5`, `Community 130`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 4`, `Community 132`, `Community 14`, `Community 15`, `Community 13`, `Community 17`, `Community 148`, `Community 20`, `Community 150`, `Community 21`, `Community 24`, `Community 23`, `Community 26`, `Community 28`, `Community 29`, `Community 157`, `Community 31`, `Community 158`, `Community 33`, `Community 36`, `Community 38`, `Community 169`, `Community 170`, `Community 41`, `Community 174`, `Community 50`, `Community 178`, `Community 56`, `Community 185`, `Community 60`, `Community 61`, `Community 62`, `Community 63`, `Community 65`, `Community 69`, `Community 72`, `Community 73`, `Community 200`, `Community 74`, `Community 201`, `Community 79`, `Community 83`, `Community 84`, `Community 213`, `Community 85`, `Community 88`, `Community 89`, `Community 95`, `Community 97`, `Community 102`, `Community 105`, `Community 108`, `Community 110`, `Community 112`, `Community 113`, `Community 116`, `Community 119`, `Community 121`, `Community 122`, `Community 124`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **What connects `ADR-0004`, `ADR-0003`, `../../tsconfig.base.json` to the rest of the system?**
  _100 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.027775773753697424 - nodes in this community are weakly interconnected._
- **Why does `next` connect `Community 27` to `Community 129`, `Community 130`, `Community 3`, `Community 132`, `Community 4`, `Community 5`, `Community 8`, `Community 138`, `Community 13`, `Community 143`, `Community 144`, `Community 145`, `Community 17`, `Community 149`, `Community 23`, `Community 152`, `Community 155`, `Community 28`, `Community 30`, `Community 32`, `Community 33`, `Community 42`, `Community 175`, `Community 187`, `Community 74`, `Community 77`, `Community 79`, `Community 80`, `Community 85`, `Community 93`, `Community 95`, `Community 96`, `Community 100`, `Community 109`, `Community 110`, `Community 111`, `Community 114`, `Community 119`, `Community 123`, `Community 125`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08232118758434548 - nodes in this community are weakly interconnected._
- **Why does `dec` connect `Community 63` to `Community 2`, `Community 7`, `Community 9`, `Community 12`, `Community 14`, `Community 16`, `Community 22`, `Community 26`, `Community 35`, `Community 164`, `Community 43`, `Community 47`, `Community 51`, `Community 54`, `Community 60`, `Community 66`, `Community 72`, `Community 80`, `Community 92`, `Community 105`, `Community 108`, `Community 116`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11363636363636363 - nodes in this community are weakly interconnected._