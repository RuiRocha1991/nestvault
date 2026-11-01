'use client';

import { Button, Chip, Modal, Table, Td, Th, formatMoney, formatPct } from '@nestvault/ui';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type DragEvent } from 'react';

import {
  IMPORT_MAX_BYTES,
  commitImport,
  hasImportExtension,
  importForm,
  importProblemKey,
  parseWarning,
  planTotals,
  previewImport,
  sheetKey,
  templateUrl,
  type RealEstatePreview,
} from '@webapp/lib/real-estate-import';

type Step =
  | { name: 'choose' }
  | { name: 'reading' }
  | { name: 'preview'; file: File; preview: RealEstatePreview }
  | { name: 'writing'; file: File; preview: RealEstatePreview }
  | { name: 'done'; created: number; updated: number; unchanged: number };

/**
 * Mockup 44: import of the owner's spreadsheet or a CSV template into this property and its loan.
 * The file is read twice by the server (a preview, then the commit), so nothing is stored between
 * the two steps and nothing is written before "Importar". The preview carries the plan for both
 * values of "update existing", so the checkbox never needs another upload.
 */
export function ImportDialog({
  open,
  onOpenChange,
  poolId,
  propertyId,
  loanId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poolId: string;
  propertyId: string;
  /** The loan of the property, if it has one. */
  loanId: string | null;
  onImported: () => void;
}) {
  const t = useTranslations('realEstate.import');
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const [update, setUpdate] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Answers that arrive after the dialog was closed or another file was chosen are dropped.
  const generation = useRef(0);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      generation.current += 1;
      setDragging(false);
      setStep({ name: 'choose' });
      setProblem(null);
      setUpdate(true);
    }
  }

  async function read(file: File, wantUpdate: boolean) {
    setProblem(null);
    if (!hasImportExtension(file.name)) {
      setProblem('unsupported');
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setProblem('tooLarge');
      return;
    }
    setStep({ name: 'reading' });
    generation.current += 1;
    const mine = generation.current;
    const answer = await previewImport(
      poolId,
      importForm(file, { loanId, propertyId }, wantUpdate),
    );
    if (mine !== generation.current) return;
    if (answer.ok) {
      setStep({ name: 'preview', file, preview: answer.data });
    } else {
      setStep({ name: 'choose' });
      setProblem(importProblemKey(answer.problem));
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (step.name !== 'choose') return;
    const file = event.dataTransfer.files[0];
    if (file) void read(file, update);
  }

  async function write() {
    if (step.name !== 'preview') return;
    const { file, preview } = step;
    setProblem(null);
    setStep({ name: 'writing', file, preview });
    const mine = generation.current;
    const answer = await commitImport(poolId, importForm(file, { loanId, propertyId }, update));
    if (mine !== generation.current) return;
    if (answer.ok) {
      const { created, updated, unchanged } = planTotals(answer.data.result);
      setStep({ name: 'done', created, updated, unchanged });
      onImported();
    } else {
      setStep({ name: 'preview', file, preview });
      setProblem(importProblemKey(answer.problem));
    }
  }

  const preview = step.name === 'preview' || step.name === 'writing' ? step.preview : null;
  const counts = preview?.plan ? preview.plan[update ? 'update' : 'keep'] : null;
  const totals = counts ? planTotals(counts) : null;
  const importable = preview ? preview.sheets.filter((sheet) => sheet.action === 'import') : [];
  const blocked = !!preview && preview.needs.loan && !loanId;
  const nothingNew = !!totals && totals.created === 0 && totals.updated === 0;

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={t('title')}
      closeLabel={t('close')}
      wide
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              close(false);
            }}
          >
            {t('cancel')}
          </Button>
          {!!preview && (
            <Button
              variant="primary"
              disabled={step.name === 'writing' || blocked || nothingNew}
              onClick={() => void write()}
            >
              {step.name === 'writing'
                ? t('submitting')
                : t('submit', { count: totals ? totals.created + totals.updated : 0 })}
            </Button>
          )}
        </>
      }
    >
      {(step.name === 'choose' || step.name === 'reading') && (
        <>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => {
              setDragging(false);
            }}
            onDrop={drop}
            className={`flex flex-col items-center gap-3 rounded-md border border-dashed bg-inset p-8 text-center ${dragging ? 'border-accent' : 'border-line-2'}`}
          >
            <b className="text-lg">{t('prompt')}</b>
            <p className="m-0 max-w-[52ch] text-sm text-fg-3">{t('hint')}</p>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv"
              aria-label={t('inputLabel')}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void read(file, update);
              }}
            />
            <Button
              variant="primary"
              disabled={step.name === 'reading'}
              onClick={() => {
                input.current?.click();
              }}
            >
              {step.name === 'reading' ? t('reading') : t('choose')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            <b>{t('templates')}</b>
            <a
              className="inline-flex items-center gap-1 text-accent-2 underline"
              href={templateUrl(poolId, 'loan-installments')}
            >
              <Download aria-hidden className="size-4" />
              {t('templateInstallments')}
            </a>
            <a
              className="inline-flex items-center gap-1 text-accent-2 underline"
              href={templateUrl(poolId, 'works-payments')}
            >
              <Download aria-hidden className="size-4" />
              {t('templateWorks')}
            </a>
          </div>
        </>
      )}

      {!!preview && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-inset p-3">
            <b className="min-w-0 break-all">{preview.fileName}</b>
            <Chip tone="pos">
              {t('detected', { percent: formatPct(preview.confidence * 100, { digits: 0 }) })}
            </Chip>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>{t('sheet')}</Th>
                <Th>{t('what')}</Th>
                <Th numeric>{t('rows')}</Th>
                <Th>{t('action')}</Th>
              </tr>
            </thead>
            <tbody>
              {preview.sheets.map((sheet) => (
                <tr key={`${sheet.sheet}-${sheet.action}`}>
                  <Td>
                    <b>{sheetKey(sheet.sheet).startsWith('csv') ? t('csvFile') : sheet.sheet}</b>
                  </Td>
                  <Td className={sheet.action === 'import' ? '' : 'text-fg-2'}>
                    {sheet.action === 'recalculated'
                      ? t('recalculated')
                      : t(`sheets.${sheetKey(sheet.sheet) as 'installments'}`)}
                  </Td>
                  <Td numeric>{sheet.action === 'recalculated' ? '—' : sheet.rows}</Td>
                  <Td>
                    <Chip tone={sheet.action === 'import' ? 'accent' : 'default'}>
                      {t(`actions.${sheet.action}`)}
                    </Chip>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {importable.length === 0 && <p className="m-0 text-sm text-fg-3">{t('nothingNew')}</p>}
          {preview.sheets.some((sheet) => sheet.action === 'shown') && (
            <p className="m-0 text-sm text-fg-2">{t('shownNotStored')}</p>
          )}
          {!!preview.costs && (
            <p className="m-0 text-sm text-fg-2">
              {t('costs', { total: formatMoney(preview.costs.total) })}
            </p>
          )}
          {preview.fieldsWithValues.length > 0 && (
            <p className="m-0 text-sm text-fg-2">
              {t('fields', {
                fields: preview.fieldsWithValues.map((key) => t(`field.${key}`)).join(', '),
              })}
            </p>
          )}

          {(!!preview.notices.creditInsurance || !!preview.inflation) && (
            <div className="rounded-md bg-inset p-3 text-sm text-fg-2">
              <b className="text-fg">{t('noticeTitle')}</b>{' '}
              {!!preview.notices.creditInsurance &&
                t('noticeCredit', { amount: formatMoney(preview.notices.creditInsurance) })}{' '}
              {!!preview.inflation &&
                preview.notices.inflationSummed &&
                t('noticeInflation', {
                  compounded: formatPct(preview.inflation.compoundedPct),
                  summed: formatPct(preview.inflation.summedPct),
                })}
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-3 text-md">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={update}
              onChange={(event) => {
                setUpdate(event.target.checked);
              }}
            />
            {t('update')}
          </label>
          <span className="text-xs text-fg-3">{t('updateHint')}</span>

          {!!totals && (
            <p className="m-0 text-sm text-fg-2">
              {nothingNew
                ? t('nothingNew')
                : t('plan', {
                    created: totals.created,
                    updated: totals.updated,
                    unchanged: totals.unchanged,
                  })}
              {totals.rejected > 0 && ` ${t('rejected', { count: totals.rejected })}`}
              {!!counts &&
                counts.payments.kept > 0 &&
                ` ${t('kept', { count: counts.payments.kept })}`}
            </p>
          )}
          {blocked && (
            <p role="alert" className="m-0 text-sm text-neg">
              {t('needsLoan')}
            </p>
          )}
          {preview.warnings.length > 0 && (
            <details className="text-sm text-fg-3">
              <summary>{t('warnings')}</summary>
              <ul className="m-0 mt-1 list-disc pl-5">
                {preview.warnings.map((warning, index) => {
                  const { key, count } = parseWarning(warning);
                  return <li key={`${index}-${warning}`}>{t(`warning.${key}`, { count })}</li>;
                })}
              </ul>
            </details>
          )}
        </>
      )}

      {step.name === 'done' && (
        <p role="status" className="m-0 text-md">
          {t('done', { created: step.created, updated: step.updated, unchanged: step.unchanged })}
        </p>
      )}

      {!!problem && (
        <p role="alert" className="m-0 text-sm text-neg">
          {t(`problem.${problem as 'generic'}`)}
        </p>
      )}
    </Modal>
  );
}
