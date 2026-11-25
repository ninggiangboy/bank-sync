import { accountMail } from "./account-mail";

export const verifyEmail = (args: Parameters<typeof accountMail>[1]) =>
  accountMail("verify-email", args);
