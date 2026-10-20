'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../cn';

import { Button } from './button';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Accessible label of the close button. */
  closeLabel: string;
  /** Footer actions. */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * A side panel on desktop and a bottom sheet on mobile. Radix Dialog: focus trap, Escape to close,
 * focus restored to the element that opened it.
 */
export function Sheet({ open, onOpenChange, title, closeLabel, footer, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[3px]" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col overflow-auto border-line-2 bg-panel',
            'shadow-[0_24px_64px_rgba(0,0,0,0.35)]',
            'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t',
            'md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[420px] md:rounded-none md:border-l md:border-t-0',
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
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <div className="flex flex-1 flex-col gap-4 p-5">{children}</div>
          {!!footer && (
            <footer className="flex justify-end gap-2 border-t border-line px-5 pb-4 pt-3">
              {footer}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
