import nodemailer from 'nodemailer';

// Account email via Brevo SMTP. MAIL_MODE=log prints the message instead
// (local development and tests); links are then read from the API's stdout.
const mode = Deno.env.get('MAIL_MODE') ?? 'smtp';

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransport() {
  if (!transport) {
    const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
    transport = nodemailer.createTransport({
      host: Deno.env.get('SMTP_HOST'),
      port,
      secure: port === 465,
      auth: { user: Deno.env.get('SMTP_USER'), pass: Deno.env.get('SMTP_PASS') },
    });
  }
  return transport;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (mode === 'log') {
    console.log(JSON.stringify({ fn: 'mailer', event: 'mail', to: mail.to, subject: mail.subject, text: mail.text }));
    return;
  }
  const name = Deno.env.get('SMTP_SENDER_NAME') ?? 'Wurmple';
  const from = Deno.env.get('SMTP_ADMIN_EMAIL') ?? 'no-reply@ajmsd.space';
  await getTransport().sendMail({ from: `"${name}" <${from}>`, ...mail });
}

/** Sends without blocking the response (keeps timing equal for known/unknown emails). */
export function sendMailInBackground(mail: Mail, event: string): void {
  sendMail(mail).catch((err) =>
    console.error(JSON.stringify({ fn: 'mailer', event: `${event}_failed`, error: String(err) })));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function layout(heading: string, body: string, link: string, button: string): string {
  const href = escapeHtml(link);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;max-width:480px;margin:auto;padding:24px">
<h2 style="color:#cc0000">${escapeHtml(heading)}</h2>
<p>${escapeHtml(body)}</p>
<p><a href="${href}" style="display:inline-block;background:#cc0000;color:#fff;padding:10px 18px;text-decoration:none;font-weight:bold">${escapeHtml(button)}</a></p>
<p style="font-size:12px;color:#666">Or paste this link into your browser:<br>${href}</p>
<p style="font-size:12px;color:#666">If you didn't ask for this, you can ignore this email.</p>
</body></html>`;
}

export function verifyEmailMail(to: string, link: string): Mail {
  const body = 'Confirm your email to finish creating your Wurmple Trainer account. This link expires in 24 hours.';
  return {
    to,
    subject: 'Confirm your Wurmple account',
    text: `${body}\n\n${link}\n\nIf you didn't sign up, you can ignore this email.`,
    html: layout('Welcome, Trainer!', body, link, 'Confirm email'),
  };
}

export function resetPasswordMail(to: string, link: string): Mail {
  const body = 'Someone asked to reset the password for your Wurmple account. This link expires in 1 hour.';
  return {
    to,
    subject: 'Reset your Wurmple password',
    text: `${body}\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: layout('Reset your password', body, link, 'Choose a new password'),
  };
}
