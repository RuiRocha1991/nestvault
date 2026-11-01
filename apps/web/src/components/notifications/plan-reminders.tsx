'use client';

import { Button, Card, CardHeader, Chip, formatMoney, useToast } from '@nestvault/ui';
import { Check, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

import { AssetCell } from '@webapp/components/portfolios/asset-badge';
import { formatPeriod, type PlanReminderView } from '@webapp/lib/plan-reminders-view';
import { postJson } from '@webapp/lib/post-json';
import { createReminderActions, type ReminderNotice } from '@webapp/lib/reminder-actions';

export interface PlanRemindersProps {
  poolId: string;
  reminders: readonly PlanReminderView[];
  /**
   * `banner`: the unread reminders on top of the overview (marking one as read dismisses it).
   * `list`: every open reminder, read ones labelled, with the unread badge.
   */
  variant: 'banner' | 'list';
  /** `ops.write`: the server enforces it; without it the button is hidden. */
  canRegister: boolean;
}

/**
 * "Investimentos regulares por registar" (the prototype's warn-bordered card): asset, amount, plan
 * day and portfolio, and "Registar compra". It runs the plan for the reminder's month through the
 * plan-run endpoint, which also resolves the reminder, so the row goes away after the refresh.
 * Marking as read is personal (each member has their own state).
 */
export function PlanReminders({ poolId, reminders, variant, canRegister }: PlanRemindersProps) {
  const t = useTranslations('notifications.planReminder');
  const router = useRouter();
  const toast = useToast();
  const region = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The actions read the latest `t`, `router` and `toast` without being rebuilt: the in-flight
  // guard lives in them.
  const latest = useRef({ t, router, toast });
  latest.current = { t, router, toast };
  const actions = useMemo(
    () =>
      createReminderActions(poolId, {
        post: postJson,
        refresh: () => {
          latest.current.router.refresh();
        },
        notify: (notice: ReminderNotice) => {
          latest.current.toast.show(latest.current.t(`notices.${notice}`));
        },
        setBusy,
        // The clicked row is about to go away: keep the keyboard user in the card.
        settled: () => region.current?.focus(),
      }),
    [poolId],
  );

  const shown = variant === 'banner' ? reminders.filter((r) => !r.read) : reminders;
  const unread = reminders.filter((r) => !r.read).length;
  if (shown.length === 0) return null;

  return (
    <div
      ref={region}
      tabIndex={-1}
      className="outline-none"
      data-testid={`plan-reminders-${variant}`}
    >
      <Card className="border border-warn" aria-busy={busy !== null}>
        <CardHeader
          title={t('title')}
          headingLevel={3}
          actions={
            variant === 'list' &&
            unread > 0 && (
              <Chip tone="warn" data-testid="plan-reminders-unread">
                {t('unread', { count: unread })}
              </Chip>
            )
          }
        />
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((r) => {
            const period = formatPeriod(r.period);
            const working = busy === r.id;
            return (
              <li
                key={r.id}
                data-testid="plan-reminder"
                className="flex flex-wrap items-center gap-x-3 gap-y-2"
              >
                <AssetCell ticker={r.ticker} type={r.assetType} compact />
                <span className="text-md text-fg-2">
                  {t('details', {
                    amount: formatMoney(r.amount, r.currency),
                    day: r.day,
                    portfolio: r.portfolioName,
                    period,
                  })}
                </span>
                {r.read && <Chip>{t('read')}</Chip>}
                <span className="grow" />
                {!r.read && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    aria-label={t('markReadLabel', { ticker: r.ticker, period })}
                    onClick={() => {
                      void actions.markRead(r);
                    }}
                  >
                    <Check aria-hidden />
                    {t('markRead')}
                  </Button>
                )}
                {canRegister && r.active && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy !== null}
                    aria-label={t('registerLabel', { ticker: r.ticker, period })}
                    onClick={() => {
                      void actions.register(r);
                    }}
                  >
                    <Play aria-hidden />
                    {working ? t('registering') : t('register')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
