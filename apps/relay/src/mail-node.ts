import nodemailer from 'nodemailer';

import {
    type SendEmail,
    type SmtpConfiguration,
} from './mail.js';

export const createNodeMailer = (
    configuration: SmtpConfiguration | undefined,
): SendEmail | undefined => {
    if (!configuration) {
        return undefined;
    }

    const transporter = nodemailer.createTransport({
        auth: configuration.username
            ? { user: configuration.username, pass: configuration.password }
            : undefined,
        host: configuration.host,
        ignoreTLS: configuration.security === 'none',
        port: configuration.port,
        requireTLS: configuration.security === 'starttls',
        secure: configuration.security === 'tls',
    });

    return async (email) => {
        await transporter.sendMail({
            html: email.html,
            subject: email.subject,
            text: email.text,
            from: {
                address: configuration.from.email,
                name: configuration.from.name ?? '',
            },
            to: email.recipient,
        });
    };
};
