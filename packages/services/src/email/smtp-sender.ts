import { createTransport } from 'nodemailer';

import type { Logger } from '../logger';

import type { EmailSender } from './types';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string | undefined;
  password?: string | undefined;
  /** `"Name <address>"`. */
  from: string;
  log?: Logger;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * SMTP through nodemailer. Mailpit in development (loopback, port 1025, no TLS, no login). Anywhere
 * else, or with credentials, the connection must upgrade to TLS (STARTTLS, or implicit TLS on 465)
 * before anything is sent: the messages carry links that take over an account.
 */
export function createSmtpSender(
  config: SmtpConfig,
  /** Tests replace nodemailer's `createTransport`. */
  makeTransport: typeof createTransport = createTransport,
): EmailSender {
  const authenticated = Boolean(config.user);
  const transport = makeTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: authenticated || !LOOPBACK.has(config.host),
    ...(authenticated ? { auth: { user: config.user ?? '', pass: config.password ?? '' } } : {}),
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    async send(message) {
      try {
        await transport.sendMail({ from: config.from, ...message });
      } catch (error) {
        // The error is logged by type only (the logger drops messages): it may echo the recipient.
        config.log?.error({ err: error }, 'email delivery failed');
        throw error;
      }
    },
  };
}
