import type { EmailMessage, EmailSender } from './types';

/** Collects messages instead of sending them. Tests read `sent`. */
export interface MemoryEmailSender extends EmailSender {
  readonly sent: readonly EmailMessage[];
  clear(): void;
}

export function createMemoryEmailSender(): MemoryEmailSender {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
    clear() {
      sent.length = 0;
    },
  };
}
