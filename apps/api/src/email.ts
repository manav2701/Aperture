import type { Email } from '@aperture/runtime';

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
