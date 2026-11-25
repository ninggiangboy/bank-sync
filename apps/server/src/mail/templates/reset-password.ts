import { accountMail } from "./account-mail";

export const resetPassword = (args: Parameters<typeof accountMail>[1]) =>
  accountMail("reset-password", args);
