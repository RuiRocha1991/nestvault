import type { EmailMessage } from './types';

// pt-PT email templates (HTML + plain text). Everything interpolated into HTML is escaped; links
// are built by the caller from the app origin and a token and are the only thing that matters in
// the message, so they are shown in full in the text part too.

export type EmailContent = Pick<EmailMessage, 'subject' | 'html' | 'text'>;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

interface Layout {
  subject: string;
  heading: string;
  paragraphs: readonly string[];
  action?: { label: string; url: string };
  /** A plain link under the button (for example "recover the password"). */
  secondaryAction?: { label: string; url: string };
  footer: string;
}

function render(layout: Layout): EmailContent {
  const paragraphsHtml = layout.paragraphs
    .map((p) => `<p style="margin:0 0 14px;line-height:1.5">${escapeHtml(p)}</p>`)
    .join('');
  const actionHtml = layout.action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(layout.action.url)}" style="background:#7c3aed;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(layout.action.label)}</a></p>` +
      `<p style="margin:0 0 14px;font-size:13px;color:#6b7280;word-break:break-all">${escapeHtml(layout.action.url)}</p>`
    : '';
  const secondaryHtml = layout.secondaryAction
    ? `<p style="margin:0 0 14px"><a href="${escapeHtml(layout.secondaryAction.url)}" style="color:#7c3aed;font-weight:600">${escapeHtml(layout.secondaryAction.label)}</a></p>`
    : '';
  const html =
    `<!doctype html><html lang="pt-PT"><body style="margin:0;background:#f4f4f8;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1f2937">` +
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">` +
    `<p style="margin:0 0 18px;font-weight:800;letter-spacing:.04em">COFRE</p>` +
    `<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(layout.heading)}</h1>` +
    paragraphsHtml +
    actionHtml +
    secondaryHtml +
    `<p style="margin:18px 0 0;font-size:13px;color:#6b7280">${escapeHtml(layout.footer)}</p>` +
    `</div></body></html>`;
  const text = [
    layout.heading,
    '',
    ...layout.paragraphs,
    ...(layout.action ? ['', `${layout.action.label}: ${layout.action.url}`] : []),
    ...(layout.secondaryAction
      ? [`${layout.secondaryAction.label}: ${layout.secondaryAction.url}`]
      : []),
    '',
    layout.footer,
  ].join('\n');
  return { subject: layout.subject, html, text };
}

const IGNORE_FOOTER = 'Se não foste tu, podes ignorar esta mensagem.';

export function verifyEmailTemplate(input: { name: string; url: string }): EmailContent {
  return render({
    subject: 'Confirma o teu email',
    heading: 'Confirma o teu email',
    paragraphs: [
      `Olá ${input.name}, confirma o teu email para ativares a conta.`,
      'A ligação expira em 24 horas.',
    ],
    action: { label: 'Confirmar email', url: input.url },
    footer: IGNORE_FOOTER,
  });
}

export function resetPasswordTemplate(input: { name: string; url: string }): EmailContent {
  return render({
    subject: 'Recuperar a palavra-passe',
    heading: 'Recuperar a palavra-passe',
    paragraphs: [
      `Olá ${input.name}, recebemos um pedido para criares uma nova palavra-passe.`,
      'A ligação só pode ser usada uma vez e expira em 1 hora. Ao guardares a nova palavra-passe, terminamos a sessão em todos os dispositivos.',
    ],
    action: { label: 'Criar nova palavra-passe', url: input.url },
    footer: IGNORE_FOOTER,
  });
}

export function passwordChangedTemplate(input: { name: string }): EmailContent {
  return render({
    subject: 'A tua palavra-passe foi alterada',
    heading: 'A tua palavra-passe foi alterada',
    paragraphs: [
      `Olá ${input.name}, a palavra-passe da tua conta foi alterada e terminámos a sessão em todos os dispositivos.`,
      'Se não foste tu, recupera a conta de imediato com "Esqueci-me da palavra-passe" no ecrã de entrada e avisa o proprietário do agregado.',
    ],
    footer: 'Esta mensagem é só informativa.',
  });
}

export function inviteTemplate(input: {
  inviter: string;
  poolName: string;
  url: string;
}): EmailContent {
  return render({
    subject: `Convite para o agregado ${input.poolName}`,
    heading: 'Foste convidado para um agregado',
    paragraphs: [
      `${input.inviter} convidou-te para o agregado "${input.poolName}" no Cofre Familiar.`,
      'O convite é pessoal e expira em breve.',
    ],
    action: { label: 'Ver convite', url: input.url },
    footer: IGNORE_FOOTER,
  });
}

/** Sent to an address that already has an account when somebody tries to register with it. */
export function existingAccountTemplate(input: {
  name: string;
  loginUrl: string;
  resetUrl: string;
}): EmailContent {
  return render({
    subject: 'Já tens uma conta',
    heading: 'Já tens uma conta',
    paragraphs: [
      `Olá ${input.name}, alguém tentou criar uma conta com este email, mas já tens uma. Nada foi alterado.`,
      'Se te esqueceste da palavra-passe, podes recuperá-la.',
    ],
    action: { label: 'Entrar', url: input.loginUrl },
    secondaryAction: { label: 'Recuperar a palavra-passe', url: input.resetUrl },
    footer: IGNORE_FOOTER,
  });
}
