import { createTransport } from "nodemailer";
import { env } from "../config/env";

export type MailMessage = { to: string; subject: string; text: string; html?: string };
export type Mailer = { send(message: MailMessage): Promise<void> };

type MailerOptions = {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
};

/**
 * Sends mail over SMTP. With no host configured it logs the recipient, subject and body to the
 * console instead, so a development setup can follow verification and reset links without a server.
 */
export function createMailer(
  options: MailerOptions = {
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    username: env.MAIL_USERNAME,
    password: env.MAIL_PASSWORD,
    from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`,
  },
): Mailer {
  if (options.host === "") {
    return {
      async send({ to, subject, text }) {
        console.info(`Mail to ${to}\nSubject: ${subject}\n\n${text}`);
      },
    };
  }
  const transport = createTransport({
    host: options.host,
    port: options.port,
    secure: options.port === 465,
    ...(options.username ? { auth: { user: options.username, pass: options.password } } : {}),
  });
  return {
    async send(message) {
      await transport.sendMail({ from: options.from, ...message });
    },
  };
}
