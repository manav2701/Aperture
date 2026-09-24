import type { Logger } from '@aperture/runtime';

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

export const emails = {
  verify: (url: string): Omit<Email, 'to'> => ({
    subject: 'Verify your email for Aperture',
    text: `Welcome to Aperture.\n\nConfirm your email address to finish signing up:\n${url}\n\nIf you didn't sign up, ignore this email.`,
  }),
  resetPassword: (url: string): Omit<Email, 'to'> => ({
    subject: 'Reset your Aperture password',
    text: `Someone asked to reset the password for this email address.\n\nChoose a new password:\n${url}\n\nIf it wasn't you, ignore this email; your password stays the same.`,
  }),
  magicLink: (url: string): Omit<Email, 'to'> => ({
    subject: 'Your Aperture sign-in link',
    text: `Sign in to Aperture with this link (valid for 5 minutes):\n${url}\n\nIf you didn't ask for it, ignore this email.`,
  }),
  invitation: (input: { orgName: string; inviterName: string; role: string; url: string }): Omit<Email, 'to'> => ({
    subject: `${input.inviterName} invited you to ${input.orgName} on Aperture`,
    text:
      `${input.inviterName} invited you to join ${input.orgName} on Aperture as ${input.role.replace('_', ' ')}.\n\n` +
      `Accept the invitation (valid for 7 days):\n${input.url}\n\n` +
      `Sign in or sign up with this email address to accept.`,
  }),
};
