'use client';

import { Button, Card, Eyebrow } from '@nestvault/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Alert, IconTile } from '@webapp/components/auth/alert';
import type { AccountCard, PortfolioOption } from '@webapp/lib/accounts-types';
import { categoryMessageKey } from '@webapp/lib/category-name';
import type { CategoryView } from '@webapp/lib/expenses-types';
import {
  commitStatement,
  discardStatement,
  fetchPreview,
  importProblemKey,
  uploadStatement,
  type Answer,
} from '@webapp/lib/imports-api';
import type {
  ImportChooseParser,
  ImportCommitResult,
  ImportHistory,
  ImportNeedsMapping,
  ImportPreview,
} from '@webapp/lib/imports-types';
import {
  confidenceLevel,
  defaultAccount,
  hasAcceptedExtension,
  MAX_FILE_BYTES,
  uploadForm,
} from '@webapp/lib/imports-view';

import { DropZone } from './drop-zone';
import { HistoryBlock } from './history-block';
import { MappingStep } from './mapping-step';
import { PreviewStep } from './preview-step';

type Step =
  | { name: 'drop' }
  | { name: 'choose'; data: ImportChooseParser }
  | { name: 'mapping'; data: ImportNeedsMapping; spec: ImportNeedsMapping['spec'] }
  | { name: 'preview'; data: ImportPreview }
  | { name: 'done'; data: ImportCommitResult };

export interface ImportScreenProps {
  poolId: string;
  accounts: readonly AccountCard[];
  portfolios: readonly PortfolioOption[];
  categories: readonly CategoryView[];
  /** The history block under the flow; the dialogs leave it out. */
  history?: ImportHistory;
  /** Inside a dialog: no lead text, no history, and "Fechar" instead of the link to Contas. */
  onClose?: () => void;
}

/**
 * The import screen (modals 21 and 22 as one flow): drop a file, the format is detected, choose the
 * account, read the preview and confirm. The file stays in memory while the user picks a format or
 * confirms a column mapping, so a second upload never asks for it again. Hiding is cosmetic: the
 * API checks `imports.run`, the pool and the strict body on every call.
 */
export function ImportScreen({
  poolId,
  accounts,
  portfolios,
  categories,
  history,
  onClose,
}: ImportScreenProps) {
  const t = useTranslations('imports');
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'drop' });
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The batch left pending by an abandoned preview, dropped when the user starts over.
  const [pending, setPending] = useState<string | null>(null);

  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));

  function fail<T>(answer: Answer<T>) {
    if (!answer.ok) setProblem(t(`errors.${importProblemKey(answer.problem)}`));
  }

  /** Shows what an upload answered; a preview without an account tries the one the file names. */
  async function receive(start: Awaited<ReturnType<typeof uploadStatement>>, source: File) {
    if (!start.ok) {
      fail(start);
      return;
    }
    const data = start.data;
    if (data.status === 'choose-parser') {
      setStep({ name: 'choose', data });
    } else if (data.status === 'needs-mapping') {
      setStep({ name: 'mapping', data, spec: data.spec });
    } else {
      setPending(data.batchId);
      const wanted = accountId || defaultAccount(data, accounts);
      setAccountId(wanted);
      if (wanted && data.accountId !== wanted) {
        const detailed = await fetchPreview(poolId, data.batchId, wanted);
        if (detailed.ok) {
          setStep({ name: 'preview', data: detailed.data });
          return;
        }
        fail(detailed);
      }
      setStep({ name: 'preview', data });
    }
    setFile(source);
  }

  async function upload(
    source: File,
    options: { parserId?: string; spec?: unknown; accountId?: string } = {},
  ) {
    setBusy(true);
    setProblem(null);
    const answer = await uploadStatement(poolId, uploadForm(source, options));
    await receive(answer, source);
    setBusy(false);
  }

  function choose(picked: File) {
    if (!hasAcceptedExtension(picked.name)) {
      setProblem(t('errors.unsupported'));
      return;
    }
    if (picked.size > MAX_FILE_BYTES) {
      setProblem(t('errors.tooLarge'));
      return;
    }
    if (pending) void discardStatement(poolId, pending);
    setPending(null);
    setAccountId('');
    setFile(picked);
    void upload(picked);
  }

  async function changeAccount(next: string) {
    setAccountId(next);
    if (step.name !== 'preview' || !next) return;
    setBusy(true);
    setProblem(null);
    const answer = await fetchPreview(poolId, step.data.batchId, next);
    if (answer.ok) setStep({ name: 'preview', data: answer.data });
    else fail(answer);
    setBusy(false);
  }

  async function confirm(body: unknown) {
    if (step.name !== 'preview') return;
    setBusy(true);
    setProblem(null);
    const answer = await commitStatement(poolId, step.data.batchId, body);
    if (answer.ok) {
      setPending(null);
      setStep({ name: 'done', data: answer.data });
      router.refresh();
    } else {
      fail(answer);
    }
    setBusy(false);
  }

  function reset() {
    if (pending) void discardStatement(poolId, pending);
    setPending(null);
    setFile(null);
    setAccountId('');
    setProblem(null);
    setStep({ name: 'drop' });
  }

  const dropped = step.name === 'drop';

  return (
    <div className="flex flex-col gap-6">
      {!onClose && <p className="m-0 text-sm text-fg-3">{t('lead')}</p>}

      {!!problem && (
        <Alert tone="error" icon={<TriangleAlert aria-hidden />}>
          {problem}
        </Alert>
      )}

      <section aria-label={t('drop.title')} className="flex flex-col gap-3">
        <Eyebrow>{t('drop.title')}</Eyebrow>
        <Card>
          {dropped || !file ? (
            <DropZone onFile={choose} disabled={busy} />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="mr-auto min-w-0 truncate font-semibold">
                {t('drop.selected', { name: file.name })}
              </span>
              {step.name !== 'done' && (
                <Button disabled={busy} onClick={reset}>
                  {t('drop.chooseAnother')}
                </Button>
              )}
            </div>
          )}
          {busy && !!file && step.name === 'drop' && (
            <p role="status" className="mb-0 mt-3 text-sm text-fg-2">
              {t('drop.reading', { name: file.name })}
            </p>
          )}
        </Card>
      </section>

      {step.name === 'choose' && !!file && (
        <ChooseParser
          data={step.data}
          busy={busy}
          onPick={(parserId) => {
            void upload(file, { parserId });
          }}
        />
      )}

      {step.name === 'mapping' && !!file && (
        <section aria-label={t('mapping.title')} className="flex flex-col gap-3">
          <Eyebrow>{t('mapping.title')}</Eyebrow>
          <Card>
            <MappingStep
              proposal={step.data}
              spec={step.spec}
              busy={busy}
              onChange={(spec) => {
                setStep({ ...step, spec });
              }}
              onConfirm={() => {
                void upload(file, { spec: step.spec });
              }}
            />
          </Card>
        </section>
      )}

      {step.name === 'preview' && (
        <section aria-label={t('summary.read')} className="flex flex-col gap-3">
          <Card>
            <PreviewStep
              key={step.data.batchId}
              preview={step.data}
              accounts={accounts}
              portfolios={portfolios}
              categories={categories}
              accountId={accountId}
              busy={busy}
              onAccount={(next) => {
                void changeAccount(next);
              }}
              onConfirm={(body) => {
                void confirm(body);
              }}
              onCancel={reset}
            />
          </Card>
        </section>
      )}

      {step.name === 'done' && (
        <Card>
          <div className="flex flex-col items-center gap-3 p-4 text-center" role="status">
            <IconTile tone="success">
              <CircleCheck aria-hidden />
            </IconTile>
            <b className="text-lg">{t('done.title')}</b>
            <p className="m-0 text-fg-2">
              {t('done.text', { inserted: step.data.inserted, duplicates: step.data.duplicates })}
            </p>
            {step.data.assetsCreated > 0 && (
              <p className="m-0 text-sm text-fg-3">
                {t('done.assets', { n: step.data.assetsCreated })}
              </p>
            )}
            {step.data.openingBalanceAdjusted && (
              <p className="m-0 text-sm text-fg-3">{t('done.opening')}</p>
            )}
            <div className="flex gap-3">
              <Button variant="primary" onClick={reset}>
                {t('actions.another')}
              </Button>
              {onClose ? (
                <Button onClick={onClose}>{t('dialog.close')}</Button>
              ) : (
                <Link
                  href={`/${encodeURIComponent(poolId)}/contas`}
                  className="inline-flex h-[34px] items-center rounded-sm border border-line-2 bg-panel-2 px-3.5 text-md font-semibold hover:border-accent-2"
                >
                  {t('actions.viewAccounts')}
                </Link>
              )}
            </div>
          </div>
        </Card>
      )}

      {!!history && <HistoryBlock history={history} accountNames={accountNames} />}
    </div>
  );
}

/** Several formats fit about equally (or only a weak one does): the user picks one. */
function ChooseParser({
  data,
  busy,
  onPick,
}: {
  data: ImportChooseParser;
  busy: boolean;
  onPick: (parserId: string) => void;
}) {
  const t = useTranslations('imports');
  const [picked, setPicked] = useState(data.candidates[0]?.parserId ?? '');
  return (
    <section aria-label={t('choose.title')} className="flex flex-col gap-3">
      <Eyebrow>{t('choose.title')}</Eyebrow>
      <Card>
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-2 text-fg-2">{t('choose.text')}</legend>
          {data.candidates.map((candidate) => {
            const key = categoryMessageKey(candidate.parserId);
            const name = t.has(`parsers.${key}`) ? t(`parsers.${key}`) : candidate.parserId;
            return (
              <label key={candidate.parserId} className="flex items-center gap-2 text-md">
                <input
                  type="radio"
                  name="parser"
                  value={candidate.parserId}
                  checked={picked === candidate.parserId}
                  onChange={() => {
                    setPicked(candidate.parserId);
                  }}
                />
                {t('choose.option', {
                  parser: name,
                  level: t(`confidence.${confidenceLevel(candidate.confidence)}`),
                })}
              </label>
            );
          })}
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={busy || !picked}
              onClick={() => {
                onPick(picked);
              }}
            >
              {t('choose.use')}
            </Button>
          </div>
        </fieldset>
      </Card>
    </section>
  );
}
