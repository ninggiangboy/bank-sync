import i18n from "../i18n";
import { ApiError } from "./api";

const t = (key: string, options: Record<string, unknown> = {}) => i18n.t(key, options);

/** A message for an error that is not about one field. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return t("Something went wrong on our end. Please try again later.");
  switch (error.code) {
    case "demo_read_only":
      return t(
        "This is demo data, so changes can't be saved or deleted. Switch back to your account to make changes.",
      );
    case "auth.throttle":
      return error.seconds === undefined
        ? t("Please wait before retrying.")
        : t("Too many login attempts. Please try again in {{seconds}} seconds.", {
            seconds: error.seconds,
          });
    case "too_many_attempts":
      return t("You're sending too many requests. Please wait a moment and try again.");
    case "file_too_large":
      return t("The file is too large.");
    case "unsupported_file":
      return t("Upload one .mbox file, or one or more .eml files.");
    case "INVALID_EMAIL_OR_PASSWORD":
      return t("These credentials do not match our records.");
    case "INVALID_TOKEN":
      return t("This password reset token is invalid.");
    case "demo_unavailable":
      return t("Demo data isn't available.");
    case "rule_unavailable":
      return t("This transaction has nothing a rule could match.");
    case "network":
      return t("Couldn't reach the server. Check your connection and try again.");
    case "unauthenticated":
      return t("Please sign in to view this page.");
    case "not_found":
    case "category_not_found":
    case "raw_email_not_found":
      return t("The page you're looking for doesn't exist.");
  }
  return t("Something went wrong on our end. Please try again later.");
}

/** How a field is named in messages, and its length limits. */
export type FieldInfo = { attribute: string; max?: number; min?: number };

const ucfirst = (value: string) => value.charAt(0).toLocaleUpperCase() + value.slice(1);

/** One validation code (`required`, `max`, …) of one field as a sentence. */
export function fieldMessage(code: string, info: FieldInfo, field = ""): string {
  const attribute = t(info.attribute);
  const values = { attribute, Attribute: ucfirst(attribute), max: info.max, min: info.min };
  if (code === "amount") return t("Enter an amount greater than 0.");
  if (code === "invalid" && field === "categoryId")
    return t("Pick a category that fits the transaction type.");
  if (code === "invalid" && field === "parentId")
    return t("Pick a parent category of the same type.");
  switch (code) {
    case "required":
      return t("The {{attribute}} field is required.", values);
    case "max":
      return t("The {{attribute}} field must not be greater than {{max}} characters.", values);
    case "min":
      return t("The {{attribute}} field must be at least {{min}} characters.", values);
    case "confirmed":
      return t("The {{attribute}} field confirmation does not match.", values);
    case "email":
      return t("The {{attribute}} field must be a valid email address.", values);
    case "unique":
      return t("The {{attribute}} has already been taken.", values);
    case "current_password":
      return t("The password is incorrect.");
    default:
      return t("The selected {{attribute}} is invalid.", values);
  }
}

export type FieldErrors = Record<string, string[]>;

/**
 * Turns a failed request into messages per field. Codes for fields the form does not show, and
 * errors that are not about fields, land under `_`.
 */
export function fieldErrors(error: unknown, fields: Record<string, FieldInfo>): FieldErrors {
  if (!(error instanceof ApiError) || Object.keys(error.fields).length === 0) {
    return { _: [errorMessage(error)] };
  }
  const result: FieldErrors = {};
  for (const [field, codes] of Object.entries(error.fields)) {
    const info = fields[field];
    const key = info ? field : "_";
    result[key] = [
      ...(result[key] ?? []),
      ...codes.map((code) => (info ? fieldMessage(code, info, field) : errorMessage(error))),
    ];
  }
  return result;
}

/** Checks required fields in the browser, with the same messages the server would give. */
export function requireFields(
  values: Record<string, string>,
  fields: Record<string, FieldInfo>,
): FieldErrors | null {
  const result: FieldErrors = {};
  for (const [field, value] of Object.entries(values)) {
    const info = fields[field];
    if (info && value.trim() === "") result[field] = [fieldMessage("required", info, field)];
  }
  return Object.keys(result).length > 0 ? result : null;
}
