export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one email. Implementations never log the recipient, the subject or the body (links carry tokens). */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
