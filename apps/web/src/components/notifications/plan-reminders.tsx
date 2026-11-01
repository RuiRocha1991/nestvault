'use client';

import { Button, Chip, cn, formatMoney } from '@nestvault/ui';
import { BellRing, Check, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  formatPeriod,
  markReadRequest,
  registerRequest,
  type PlanReminderView,
} from '@webapp/lib/plan-reminders-view';
import { postJson } from '@webapp/lib/post-json';

export interface PlanRemindersProps {
  poolId: string;
  reminders: readonly PlanReminderView[];
  /**
   * `banner`: the unread reminders on top of the overview (reading one dismisses it).
   * `list`: every open reminder, read ones dimmed, with the unread badge.
   */
  variant: 'banner' | 'list';
  /** `ops.write`: the server enforces it; without it the button is hidden. */
  canRegister: boolean;
}

/**
 * "Investimento regular por registar" reminders. "Registar" runs the plan for the reminder's month
 * through the plan-run endpoint; the worker resolves the reminder once the buy exists, so the row
 * stays until then. Marking as read is personal (each member has their own state).
 */
export function PlanReminders({ poolId, reminders, variant, canRegister }: PlanRemindersProps) {
  const t = useTranslations('notifications.planReminder');
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const shown = variant === 'banner' ? reminders.filter((r) => !r.read) : reminders;
  const unread = reminders.filter((r) => !r.read).length;
  if (shown.length === 0) return null;

  async function send(id: string, request: () => Promise<Response>) {
    if (busy) return;
    setBusy(id);
    setFailed(false);
    try {
      const response = await request();
      if (response.ok) router.refresh();
      else setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(null);
  }

  const call = ({ path, body }: { path: string; body: unknown }) => postJson(path, body);
  const markRead = (r: PlanReminderView) => send(r.id, () => call(markReadRequest(poolId, r)));
  const register = (r: PlanReminderView) => send(r.id, () => call(registerRequest(poolId, r)));

  return (
    <section
      aria-label={t('region')}
      data-testid={`plan-reminders-${variant}`}
      className="flex flex-col gap-2 rounded-md border border-warn bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-3 py-2.5"
    >
      {variant === 'list' && (
        <header className="flex items-center gap-2 text-md font-semibold">
          <BellRing aria-hidden className="size-[18px] text-warn" />
          {t('title')}
          {unread > 0 && (
            <Chip tone="warn" data-testid="plan-reminders-unread">
              {t('unread', { count: unread })}
            </Chip>
          )}
        </header>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {shown.map((r) => (
          <li
            key={r.id}
            data-testid="plan-reminder"
            className={cn('flex flex-wrap items-center gap-2 text-md', r.read && 'text-fg-3')}
          >
            {variant === 'banner' && (
              <BellRing aria-hidden className="size-[18px] shrink-0 text-warn" />
            )}
            <span className="mr-auto">
              {t('message', {
                ticker: r.ticker,
                amount: formatMoney(r.amount),
                period: formatPeriod(r.period),
              })}
            </span>
            {canRegister && r.active && (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  void register(r);
                }}
              >
                <Play aria-hidden />
                {t('register')}
              </Button>
            )}
            {!r.read && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  void markRead(r);
                }}
              >
                <Check aria-hidden />
                {t('markRead')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="m-0 text-sm text-neg">
          {t('failed')}
        </p>
      )}
    </section>
  );
}
