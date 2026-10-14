'use client';

import { Button, Card, CardHeader, Chip } from '@nestvault/ui';
import { LogOut, Monitor, Smartphone, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Alert } from '@webapp/components/auth/alert';
import { sendJson } from '@webapp/lib/post-json';

export interface SessionRowData {
  id: string;
  current: boolean;
  browser: string | null;
  os: string | null;
  kind: 'desktop' | 'mobile';
  ipMasked: string | null;
  /** Already formatted on the server ("agora", "há 3 horas"). */
  lastActive: string;
}

/** The user's own sessions. Ending one deletes it on the server; the list is then read again. */
export function SessionsCard({ sessions }: { sessions: readonly SessionRowData[] }) {
  const t = useTranslations('account.sessions');
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    { kind: 'error' } | { kind: 'others'; count: number } | null
  >(null);

  const others = sessions.filter((session) => !session.current).length;

  async function run(key: string, request: () => Promise<Response>) {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      const response = await request();
      if (!response.ok) throw new Error('request failed');
      if (key === 'others') {
        const body = (await response.json()) as { revoked: number };
        setNotice({ kind: 'others', count: body.revoked });
      }
      router.refresh();
    } catch {
      setNotice({ kind: 'error' });
    }
    setBusy(null);
  }

  const deviceName = (session: SessionRowData) =>
    session.browser && session.os
      ? t('deviceOn', { browser: session.browser, os: session.os })
      : (session.browser ?? session.os ?? t('unknownDevice'));

  return (
    <Card>
      <CardHeader
        title={t('title')}
        subtitle={t('lead')}
        actions={
          <Button
            size="sm"
            disabled={others === 0 || busy !== null}
            onClick={() =>
              void run('others', () => sendJson('DELETE', '/api/v1/me/sessions?others=true'))
            }
          >
            <LogOut aria-hidden />
            {t('endOthers')}
          </Button>
        }
      />
      {notice?.kind === 'error' && (
        <Alert tone="error" icon={<TriangleAlert aria-hidden />}>
          {t('errorText')}
        </Alert>
      )}
      {notice?.kind === 'others' && (
        <p role="status" className="text-sm text-pos">
          {t('endedOthers', { count: notice.count })}
        </p>
      )}

      <ul className="m-0 flex list-none flex-col p-0">
        <li
          aria-hidden
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line px-1 pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-fg-3 sm:grid-cols-[minmax(0,1fr)_200px_90px]"
        >
          <span>{t('device')}</span>
          <span className="hidden sm:block">{t('lastActivity')}</span>
          <span />
        </li>
        {sessions.map((session) => {
          const Icon = session.kind === 'mobile' ? Smartphone : Monitor;
          return (
            <li
              key={session.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-1 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_200px_90px]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-md bg-panel-2 text-fg-2"
                >
                  <Icon className="size-[18px]" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <p className="flex flex-wrap items-center gap-2 text-md font-semibold">
                    {deviceName(session)}
                    {session.current && <Chip tone="accent">{t('current')}</Chip>}
                  </p>
                  {session.ipMasked && <p className="text-sm text-fg-3">{session.ipMasked}</p>}
                </div>
              </div>
              <span className="hidden text-md text-fg-2 sm:block">
                {session.current ? t('now') : session.lastActive}
              </span>
              <span className="text-right">
                {!session.current && (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy !== null}
                    aria-label={t('endLabel', { device: deviceName(session) })}
                    onClick={() =>
                      void run(session.id, () =>
                        sendJson('DELETE', `/api/v1/me/sessions/${session.id}`),
                      )
                    }
                  >
                    {t('end')}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
