/**
 * email/templates.ts — minimal versioned email templates (Phase 05, Task 05).
 *
 * Each renderer returns { subject, text, html } for a specific transactional
 * email: verification, invitation, password reset. Templates are versioned via
 * EMAIL_TEMPLATE_VERSION so changes can be tracked/revisioned. Plain,
 * dependency-free string building — no external template engine.
 */

export const EMAIL_TEMPLATE_VERSION = "1.0.0";

export interface VerificationVars {
  link: string;
  displayName?: string | null;
}

export interface InvitationVars {
  link: string;
  orgName: string;
  inviter?: string | null;
}

export interface PasswordResetVars {
  link: string;
  login?: string | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderVerificationEmail(vars: VerificationVars): RenderedEmail {
  const name = vars.displayName ? escapeHtml(vars.displayName) : "there";
  const link = vars.link;
  return {
    subject: "Verify your OmniRoute account",
    text: `Hi ${name},\n\nPlease verify your email address by visiting:\n${link}\n\nIf you did not request this, you can ignore this email.\n`,
    html: `<p>Hi ${name},</p><p>Please verify your email address by clicking the link below:</p><p><a href="${link}">Verify my account</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };
}

export function renderInvitationEmail(vars: InvitationVars): RenderedEmail {
  const org = escapeHtml(vars.orgName);
  const inviter = vars.inviter ? escapeHtml(vars.inviter) : "An administrator";
  const link = vars.link;
  return {
    subject: `You have been invited to join ${vars.orgName} on OmniRoute`,
    text: `${inviter} has invited you to join ${org} on OmniRoute.\n\nAccept the invitation here:\n${link}\n`,
    html: `<p>${inviter} has invited you to join <strong>${org}</strong> on OmniRoute.</p><p><a href="${link}">Accept invitation</a></p>`,
  };
}

export function renderPasswordResetEmail(vars: PasswordResetVars): RenderedEmail {
  const login = vars.login ? escapeHtml(vars.login) : "there";
  const link = vars.link;
  return {
    subject: "Reset your OmniRoute password",
    text: `Hi ${login},\n\nA password reset was requested. Reset your password here:\n${link}\n\nIf you did not request this, you can ignore this email.\n`,
    html: `<p>Hi ${login},</p><p>A password reset was requested. Choose a new password:</p><p><a href="${link}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };
}
