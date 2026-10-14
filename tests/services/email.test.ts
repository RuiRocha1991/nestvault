import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMemoryEmailSender,
  createSmtpSender,
  escapeHtml,
  inviteTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from '@nestvault/services';

const sendMail = vi.fn();
const createTransport = vi.fn((options: unknown) => ({ sendMail, options }));
/** Stands in for nodemailer's `createTransport`; only `sendMail` is used. */
const makeTransport = createTransport as unknown as Parameters<typeof createSmtpSender>[1];

const URL_WITH_TOKEN = 'http://localhost:4000/recuperar/abc123TOKEN';

describe('email templates', () => {
  it('escapes everything that comes from a user', () => {
    expect(escapeHtml(`<script>"a"&'b'</script>`)).toBe(
      '&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;',
    );
    const { html, text } = resetPasswordTemplate({
      name: '<img src=x onerror=1>',
      url: URL_WITH_TOKEN,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(text).toContain('<img src=x onerror=1>'); // the text part is not HTML
  });

  it('puts the link in the button, in clear below it and in the text part', () => {
    const { html, text, subject } = resetPasswordTemplate({ name: 'Ana', url: URL_WITH_TOKEN });
    expect(subject).toBe('Recuperar a palavra-passe');
    expect(html).toContain(`href="${URL_WITH_TOKEN}"`);
    expect(html.split(URL_WITH_TOKEN)).toHaveLength(3);
    expect(text).toContain(URL_WITH_TOKEN);
    expect(html).toContain('lang="pt-PT"');
  });

  it('cannot break out of the href attribute', () => {
    const { html } = verifyEmailTemplate({ name: 'Ana', url: 'http://x/"><script>1</script>' });
    expect(html).not.toContain('"><script>');
  });

  it('has a verification, a password-changed and an invite message in pt-PT', () => {
    expect(verifyEmailTemplate({ name: 'Ana', url: 'http://x/v' }).subject).toBe(
      'Confirma o teu email',
    );
    const changed = passwordChangedTemplate({ name: 'Ana' });
    expect(changed.subject).toBe('A tua palavra-passe foi alterada');
    expect(changed.html).not.toContain('href=');
    const invite = inviteTemplate({ inviter: 'Rui', poolName: 'Casa', url: 'http://x/i' });
    expect(invite.subject).toBe('Convite para o agregado Casa');
    expect(invite.text).toContain('http://x/i');
  });
});

describe('memory sender', () => {
  it('keeps what was sent until cleared', async () => {
    const sender = createMemoryEmailSender();
    await sender.send({ to: 'a@b.pt', subject: 's', html: 'h', text: 't' });
    expect(sender.sent).toHaveLength(1);
    sender.clear();
    expect(sender.sent).toHaveLength(0);
  });
});

describe('SMTP sender', () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it('talks plain SMTP without login (Mailpit) and sends from the configured address', async () => {
    const sender = createSmtpSender(
      { host: '127.0.0.1', port: 1025, from: 'NestVault <no-reply@x.pt>' },
      makeTransport,
    );
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 1025, secure: false, requireTLS: false }),
    );
    expect(createTransport.mock.calls[0]?.[0]).not.toHaveProperty('auth');
    sendMail.mockResolvedValue({});
    await sender.send({ to: 'a@b.pt', subject: 's', html: 'h', text: 't' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'NestVault <no-reply@x.pt>',
      to: 'a@b.pt',
      subject: 's',
      html: 'h',
      text: 't',
    });
  });

  it('requires TLS for any host that is not loopback, even without a login', () => {
    createSmtpSender({ host: 'relay.x.pt', port: 25, from: 'a@x.pt' }, makeTransport);
    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({ requireTLS: true });
  });

  it('requires TLS when it logs in, and uses implicit TLS on 465', () => {
    createSmtpSender(
      { host: 'smtp.x.pt', port: 587, user: 'u', password: 'p', from: 'a@x.pt' },
      makeTransport,
    );
    createSmtpSender(
      { host: 'smtp.x.pt', port: 465, user: 'u', password: 'p', from: 'a@x.pt' },
      makeTransport,
    );
    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({
      requireTLS: true,
      secure: false,
      auth: { user: 'u', pass: 'p' },
    });
    expect(createTransport.mock.calls[1]?.[0]).toMatchObject({ secure: true });
  });

  it('logs a failed delivery without the recipient or the body, and rethrows', async () => {
    const error = vi.fn();
    const log = { error } as never;
    const sender = createSmtpSender({ host: 'h', port: 25, from: 'a@x.pt', log }, makeTransport);
    sendMail.mockRejectedValue(new Error('550 rejected ana@example.com'));
    await expect(
      sender.send({ to: 'ana@example.com', subject: 'secret', html: 'TOKEN', text: 'TOKEN' }),
    ).rejects.toThrow();
    const logged = JSON.stringify(
      (error.mock.calls as [object, string][]).map(([fields, message]) => [
        Object.keys(fields),
        message,
      ]),
    );
    expect(logged).not.toContain('ana@example.com');
    expect(logged).not.toContain('TOKEN');
  });
});
