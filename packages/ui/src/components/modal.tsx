'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../cn';

import { Button } from './button';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Accessible label of the close button. */
  closeLabel: string;
  description?: string;
  /** Footer actions (Cancel + primary action). */
  footer?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
}

/** Radix Dialog: focus trap, Escape to close, focus restored to the trigger. */
export function Modal({
  open,
  onOpenChange,
  title,
  closeLabel,
  description,
  footer,
  wide,
  children,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[3px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(540px,calc(100%-32px))]',
            '-translate-x-1/2 -translate-y-1/2 flex-col overflow-auto rounded-lg border border-line-2',
            'bg-panel shadow-[0_24px_64px_rgba(0,0,0,0.35)]',
            wide && 'w-[min(760px,calc(100%-32px))]',
          )}
        >
          <header className="sticky top-0 flex items-center gap-2 border-b border-line bg-panel px-5 py-4">
            <Dialog.Title className="mr-auto text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" icon aria-label={closeLabel}>
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          {description ? (
            <Dialog.Description className="px-5 pt-4 text-fg-2">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="flex flex-col gap-4 p-5">{children}</div>
          {footer ? (
            <footer className="flex justify-end gap-2 border-t border-line px-5 pb-4 pt-3">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
