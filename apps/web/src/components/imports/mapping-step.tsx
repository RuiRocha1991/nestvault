'use client';

import { Button, Select, Table, Td, Th, formatDate, formatMoney } from '@nestvault/ui';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { Field } from '@webapp/components/auth/field';
import type { ImportNeedsMapping } from '@webapp/lib/imports-types';
import {
  columnOf,
  DATE_FORMATS,
  dateFormatOf,
  MAPPING_COLUMNS,
  withColumn,
  withDateFormat,
  type MappingColumn,
} from '@webapp/lib/imports-view';

export interface MappingStepProps {
  proposal: ImportNeedsMapping;
  /** The mapping being edited (starts as the proposal's). */
  spec: ImportNeedsMapping['spec'];
  busy: boolean;
  onChange: (spec: ImportNeedsMapping['spec']) => void;
  onConfirm: () => void;
}

const OPTIONAL: readonly MappingColumn[] = ['balance'];

/**
 * A csv no format recognised (generic mapping, NES-58): the guessed columns to confirm or change,
 * with the first lines they produce. Confirming uploads the file again with the mapping.
 */
export function MappingStep({ proposal, spec, busy, onChange, onConfirm }: MappingStepProps) {
  const t = useTranslations('imports.mapping');
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;
  const noRows = proposal.preview.rowCount === 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-fg-2">{t('text')}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {MAPPING_COLUMNS.map((column) => (
          <Field key={column} id={id(column)} label={t(column)}>
            <Select
              id={id(column)}
              value={columnOf(spec, column)}
              onChange={(event) => {
                onChange(withColumn(spec, column, event.target.value));
              }}
            >
              {OPTIONAL.includes(column) && <option value="">{t('none')}</option>}
              {proposal.header.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </Select>
          </Field>
        ))}
        <Field id={id('dateFormat')} label={t('dateFormat')}>
          <Select
            id={id('dateFormat')}
            value={dateFormatOf(spec)}
            onChange={(event) => {
              onChange(withDateFormat(spec, event.target.value));
            }}
          >
            {DATE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <b className="text-sm text-fg-2">{t('sample')}</b>
        {noRows ? (
          <p className="m-0 text-sm text-warn">{t('noRows')}</p>
        ) : (
          <Table aria-label={t('sample')}>
            <thead>
              <tr>
                <Th>{t('date')}</Th>
                <Th>{t('description')}</Th>
                <Th numeric>{t('amount')}</Th>
                <Th numeric>{t('balance')}</Th>
              </tr>
            </thead>
            <tbody>
              {proposal.preview.rows.slice(0, 5).map((row, index) => (
                <tr key={index}>
                  <Td>{formatDate(row.date)}</Td>
                  <Td className="max-w-[280px] truncate">{row.description}</Td>
                  <Td numeric>{formatMoney(row.amount)}</Td>
                  <Td numeric>{row.balance === null ? '' : formatMoney(row.balance)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="m-0 text-sm text-fg-3">{t('rows', { n: proposal.preview.rowCount })}</p>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" disabled={busy || noRows} onClick={onConfirm}>
          {t('confirm')}
        </Button>
      </div>
    </div>
  );
}
