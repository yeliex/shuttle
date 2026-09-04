export type SmtpSecurity = 'none' | 'starttls' | 'tls';

interface SmtpBaseConfiguration {
    from: {
        email: string;
        name?: string;
    };
    host: string;
    port: number;
    security: SmtpSecurity;
}

export type SmtpConfiguration = SmtpBaseConfiguration & ({
    password: string;
    username: string;
} | {
    password?: never;
    username?: never;
});

export interface InviteEmail {
    canPreview: boolean;
    expiresAt: Date | null;
    inviteURL: string;
    ownerName: string;
    permission: 'message' | 'read';
    recipient: string;
    resourceTitle?: string;
}

export interface OutboundEmail {
    html: string;
    recipient: string;
    subject: string;
    text: string;
}

export type SendEmail = (email: OutboundEmail) => Promise<void>;

interface SmtpEnvironment {
    SMTP_FROM?: string;
    SMTP_FROM_NAME?: string;
    SMTP_HOST?: string;
    SMTP_PASSWORD?: string;
    SMTP_PORT?: string;
    SMTP_SECURITY?: string;
    SMTP_USERNAME?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const parseSmtpConfiguration = (
    environment: SmtpEnvironment,
): SmtpConfiguration | undefined => {
    const configured = [
        environment.SMTP_FROM,
        environment.SMTP_FROM_NAME,
        environment.SMTP_HOST,
        environment.SMTP_PASSWORD,
        environment.SMTP_PORT,
        environment.SMTP_SECURITY,
        environment.SMTP_USERNAME,
    ].some((value) => value !== undefined);
    if (!configured) {
        return undefined;
    }

    const host = environment.SMTP_HOST?.trim();
    const from = environment.SMTP_FROM?.trim();
    if (!host || !from) {
        throw new Error('SMTP_HOST and SMTP_FROM are required when SMTP is configured');
    }
    if (!EMAIL_PATTERN.test(from)) {
        throw new Error('SMTP_FROM must be an email address');
    }

    const port = environment.SMTP_PORT === undefined ? 587 : Number(environment.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('SMTP_PORT must be an integer between 1 and 65535');
    }

    const security = environment.SMTP_SECURITY ?? (port === 465 ? 'tls' : 'starttls');
    if (security !== 'none' && security !== 'starttls' && security !== 'tls') {
        throw new Error('SMTP_SECURITY must be "none", "starttls", or "tls"');
    }

    const username = environment.SMTP_USERNAME?.trim();
    const password = environment.SMTP_PASSWORD;
    if ((username && password === undefined) || (!username && password !== undefined)) {
        throw new Error('SMTP_USERNAME and SMTP_PASSWORD must be configured together');
    }

    const baseConfiguration: SmtpBaseConfiguration = {
        from: {
            email: from,
        },
        host,
        port,
        security,
    };
    const fromName = environment.SMTP_FROM_NAME?.trim();
    if (fromName) {
        baseConfiguration.from.name = fromName;
    }
    if (username && password !== undefined) {
        return { ...baseConfiguration, password, username };
    }

    return baseConfiguration;
};

const escapeHtml = (value: string): string => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export const createInviteEmailContent = (invite: InviteEmail): {
    html: string;
    subject: string;
    text: string;
} => {
    const resource = invite.resourceTitle
        ? `“${invite.resourceTitle}”`
        : 'a Codex task';
    const taskPermission = invite.permission === 'message'
        ? 'read it and send messages'
        : 'read it';
    const permission = invite.canPreview
        ? `${taskPermission}, and open its shared local services`
        : taskPermission;
    const subject = `${invite.ownerName} invited you to a Shuttle task`;
    const expiration = invite.expiresAt ? `Access expires at ${invite.expiresAt.toISOString()}.` : 'Access remains available until the owner revokes it.';
    const text = [
        `${invite.ownerName} shared ${resource} with you on Shuttle. Sign in with ${invite.recipient} to access it; no invitation acceptance is required.`,
        `You can ${permission}.`,
        '',
        invite.inviteURL,
        '',
        expiration,
    ].join('\n');

    return {
        subject,
        text,
        html: `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f6f6f4;color:#20201f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">
    <div style="background:#ffffff;border:1px solid #e6e5e1;border-radius:16px;padding:32px">
      <div style="font-size:14px;font-weight:700;letter-spacing:.08em;color:#6d6c68">SHUTTLE</div>
      <h1 style="margin:20px 0 12px;font-size:24px;line-height:1.3">You’ve been invited</h1>
      <p style="margin:0 0 24px;line-height:1.6;color:#555450">${escapeHtml(invite.ownerName)} invited you to ${escapeHtml(resource)}. You can ${permission}.</p>
      <p>Sign in with ${escapeHtml(invite.recipient)} to access this task. No invitation acceptance is required.</p>
      <a href="${escapeHtml(invite.inviteURL)}" style="display:inline-block;border-radius:9px;background:#20201f;color:#ffffff;padding:11px 18px;text-decoration:none;font-weight:600">Open shared task</a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#85837d">${escapeHtml(expiration)}</p>
    </div>
  </div>
</body>
</html>`,
    };
};

export const createMagicLinkEmailContent = (loginURL: string): Omit<OutboundEmail, 'recipient'> => ({
    subject: 'Sign in to Shuttle',
    text: [
        'Use this link to sign in to Shuttle:',
        '',
        loginURL,
        '',
        'This link expires in 15 minutes and can only be used once.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f6f6f4;color:#20201f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">
    <div style="background:#ffffff;border:1px solid #e6e5e1;border-radius:16px;padding:32px">
      <div style="font-size:14px;font-weight:700;letter-spacing:.08em;color:#6d6c68">SHUTTLE</div>
      <h1 style="margin:20px 0 12px;font-size:24px;line-height:1.3">Sign in to Shuttle</h1>
      <p style="margin:0 0 24px;line-height:1.6;color:#555450">Use the button below to finish signing in.</p>
      <a href="${escapeHtml(loginURL)}" style="display:inline-block;border-radius:9px;background:#20201f;color:#ffffff;padding:11px 18px;text-decoration:none;font-weight:600">Sign in</a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#85837d">This link expires in 15 minutes and can only be used once.</p>
    </div>
  </div>
</body>
</html>`,
});

export const createVerificationEmailContent = (
    verificationURL: string,
): Omit<OutboundEmail, 'recipient'> => ({
    subject: 'Verify your Shuttle email',
    text: [
        'Verify your email address for Shuttle:',
        '',
        verificationURL,
        '',
        'This link expires in one hour.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f6f6f4;color:#20201f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">
    <div style="background:#ffffff;border:1px solid #e6e5e1;border-radius:16px;padding:32px">
      <div style="font-size:14px;font-weight:700;letter-spacing:.08em;color:#6d6c68">SHUTTLE</div>
      <h1 style="margin:20px 0 12px;font-size:24px;line-height:1.3">Verify your email</h1>
      <p style="margin:0 0 24px;line-height:1.6;color:#555450">Confirm this email address for your Shuttle account.</p>
      <a href="${escapeHtml(verificationURL)}" style="display:inline-block;border-radius:9px;background:#20201f;color:#ffffff;padding:11px 18px;text-decoration:none;font-weight:600">Verify email</a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#85837d">This link expires in one hour.</p>
    </div>
  </div>
</body>
</html>`,
});
