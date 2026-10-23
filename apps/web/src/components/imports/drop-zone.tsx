'use client';

import { Button, cn } from '@nestvault/ui';
import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type DragEvent } from 'react';

import { ACCEPTED_EXTENSIONS } from '@webapp/lib/imports-view';

export interface DropZoneProps {
  /** The file chosen or dropped; the screen checks its name and size. */
  onFile: (file: File) => void;
  disabled?: boolean;
}

/** The drop target of the import screen (csv, xlsx, pdf) with a button for keyboard users. */
export function DropZone({ onFile, disabled = false }: DropZoneProps) {
  const t = useTranslations('imports.drop');
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={drop}
      className={cn(
        'flex flex-col items-center gap-3 rounded-md border border-dashed p-8 text-center',
        over ? 'border-accent bg-accent-soft' : 'border-line-2 bg-inset',
      )}
    >
      <FileUp aria-hidden className="size-8 text-accent-2" />
      <b className="text-lg">{t('prompt')}</b>
      <p className="m-0 max-w-[52ch] text-sm text-fg-3">{t('hint')}</p>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        aria-label={t('inputLabel')}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // The same file can be chosen again after a failure.
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button
        variant="primary"
        disabled={disabled}
        onClick={() => {
          input.current?.click();
        }}
      >
        {t('choose')}
      </Button>
    </div>
  );
}
