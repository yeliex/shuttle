import { LogLevel, WorkerMailer } from 'worker-mailer';

import {
    type SendEmail,
    type SmtpConfiguration,
} from './mail.js';

export const createWorkerMailer = (
    configuration: SmtpConfiguration | undefined,
): SendEmail | undefined => {
    if (!configuration) {
        return undefined;
    }
    if (configuration.port === 25) {
        throw new Error('Cloudflare Workers cannot connect to SMTP port 25; use 587 or 465');
    }

    return async (email) => {
        await WorkerMailer.send(
            {
                authType: ['plain', 'login'],
                credentials: configuration.username
                    ? { username: configuration.username, password: configuration.password }
                    : undefined,
                host: configuration.host,
                logLevel: LogLevel.ERROR,
                port: configuration.port,
                secure: configuration.security === 'tls',
                startTls: configuration.security === 'starttls',
            },
            {
                html: email.html,
                subject: email.subject,
                text: email.text,
                from: configuration.from,
                to: email.recipient,
            },
        );
    };
};
