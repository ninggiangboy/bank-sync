import type { Locale } from "@bank-sync/shared";
import type { MailMessage } from "../mailer";

type Kind = "verify-email" | "reset-password";

const COPY: Record<
  Kind,
  Record<Locale, { subject: string; intro: string; action: string; outro: string }>
> = {
  "verify-email": {
    vi: {
      subject: "Xác minh địa chỉ email của bạn",
      intro: "Cảm ơn bạn đã đăng ký. Hãy xác minh địa chỉ email bằng liên kết dưới đây.",
      action: "Xác minh email",
      outro: "Nếu bạn không tạo tài khoản, hãy bỏ qua email này.",
    },
    en: {
      subject: "Verify your email address",
      intro: "Thanks for signing up. Verify your email address with the link below.",
      action: "Verify email",
      outro: "If you did not create an account, ignore this email.",
    },
  },
  "reset-password": {
    vi: {
      subject: "Đặt lại mật khẩu",
      intro: "Bạn nhận được email này vì có yêu cầu đặt lại mật khẩu cho tài khoản của bạn.",
      action: "Đặt lại mật khẩu",
      outro: "Liên kết hết hạn sau 60 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.",
    },
    en: {
      subject: "Reset your password",
      intro:
        "You are receiving this email because we received a password reset request for your account.",
      action: "Reset password",
      outro: "The link expires in 60 minutes. If you did not request a reset, ignore this email.",
    },
  },
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The email for a verification or reset link, in the user's language. */
export function accountMail(
  kind: Kind,
  {
    to,
    name,
    url,
    locale,
    appName,
  }: { to: string; name: string; url: string; locale: Locale; appName: string },
): MailMessage {
  const copy = COPY[kind][locale];
  const greeting = locale === "vi" ? `Xin chào ${name},` : `Hello ${name},`;
  return {
    to,
    subject: `${copy.subject} - ${appName}`,
    text: `${greeting}\n\n${copy.intro}\n\n${copy.action}: ${url}\n\n${copy.outro}\n`,
    html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(copy.intro)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(copy.action)}</a></p><p>${escapeHtml(copy.outro)}</p>`,
  };
}
