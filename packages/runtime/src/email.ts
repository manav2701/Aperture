import type { Logger } from './logger';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(email: Email): Promise<void>;
}

/** Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function resendSender(options: { apiKey: string; from: string; logger: Logger }): EmailSender {
  return {
    async send(email) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: options.from, to: [email.to], subject: email.subject, text: email.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        options.logger.error({ status: response.status, detail: detail.slice(0, 300) }, 'email send failed');
        throw new Error(`email provider returned ${String(response.status)}`);
      }
    },
  };
}

/**
 * Development only: logs the email instead of sending it, so sign-up and invite links can be
 * copied from the terminal. The API refuses to start without RESEND_API_KEY in production.
 */
export function logSender(logger: Logger): EmailSender {
  return {
    send(email) {
      logger.info(
        { emailTo: email.to, subject: email.subject, body: email.text },
        'email (not sent: development mode)',
      );
      return Promise.resolve();
    },
  };
}
