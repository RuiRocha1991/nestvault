'use client';

import { Button, Card, useToast } from '@nestvault/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type ChangeEvent } from 'react';

import { ProblemAlert } from '@webapp/components/auth/alert';
import {
  MAX_IMPORT_BYTES,
  problemOf,
  readAnswer,
  visibleCounts,
  warningKey,
  type ImportAnswer,
  type ImportProblem,
} from '@webapp/lib/prototype-import';

export interface ImportPrototypeCardProps {
  poolId: string;
}

/**
 * Definições → Importar do protótipo (NES-47): the owner picks the JSON the prototype exported, sees
 * what it would create (dry run) and then confirms. Shown to the owner only; the service checks
 * `pool.import` again, so hiding the card is cosmetic.
 */
export function ImportPrototypeCard({ poolId }: ImportPrototypeCardProps) {
  const t = useTranslations('importPrototype');
  const router = useRouter();
  const toast = useToast();
  const fileId = useId();
  const [file, setFile] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportAnswer | null>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    setPreview(null);
    setProblem(null);
    setFile(null);
    const picked = event.target.files?.[0];
    if (!picked) return;
    if (picked.size > MAX_IMPORT_BYTES) {
      setProblem('tooLarge');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await picked.text());
    } catch {
      setProblem('notJson');
      return;
    }
    setFile(parsed);
    await send(parsed, true);
  }

  async function send(body: unknown, dryRun: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/v1/pools/${encodeURIComponent(poolId)}/import-prototype`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, export: body }),
      });
      if (!response.ok) {
        setProblem(problemOf(response.status));
        return;
      }
      const answer = readAnswer(await response.json().catch(() => null));
      if (!answer) {
        setProblem('error');
        return;
      }
      if (dryRun) {
        setPreview(answer);
      } else {
        toast.show(t('done'));
        setPreview(null);
        setFile(null);
        router.refresh();
      }
    } catch {
      setProblem('error');
    } finally {
      setBusy(false);
    }
  }

  const counts = preview ? visibleCounts(preview.counts) : [];

  return (
    <Card>
      <h2 className="m-0 text-lg font-semibold">{t('title')}</h2>
      <p className="m-0 text-sm text-fg-3">{t('lead')}</p>
      {problem !== null && (
        <ProblemAlert title={t(`problem.${problem}.title`)} text={t(`problem.${problem}.text`)} />
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-sm font-medium text-fg-2">
          {t('file')}
        </label>
        <input
          id={fileId}
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            void onPick(event);
          }}
          className="text-sm text-fg-2"
        />
      </div>
      {preview !== null && (
        <div className="flex flex-col gap-3" data-testid="import-preview">
          <b>{t('previewTitle')}</b>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0 text-sm">
            {counts.map(({ key, value }) => (
              <li key={key} className="flex justify-between gap-2">
                <span className="text-fg-2">{t(`counts.${key}`)}</span>
                <span className="num">{t('count', { value })}</span>
              </li>
            ))}
          </ul>
          {preview.warnings.length > 0 && (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-fg-2">
              {preview.warnings.map((warning) => (
                <li key={warning.code}>
                  {t(`warnings.${warningKey(warning.code)}`, { count: warning.count })}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={busy || file === null}
              onClick={() => {
                void send(file, false);
              }}
            >
              {t('confirm')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
