export { createMemoryEmailSender } from './memory-sender';
export type { MemoryEmailSender } from './memory-sender';
export { createSmtpSender } from './smtp-sender';
export type { SmtpConfig } from './smtp-sender';
export {
  escapeHtml,
  inviteTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from './templates';
export type { EmailContent } from './templates';
export type { EmailMessage, EmailSender } from './types';
