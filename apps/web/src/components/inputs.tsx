import { type InputHTMLAttributes, type LabelHTMLAttributes, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./icon";

export function InputLabel({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor.
  return <label className={`block text-sm font-medium text-gray-700 ${className}`} {...props} />;
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-11 rounded-xl border-slate-300 text-base focus:border-emerald-500 focus:ring-emerald-500 ${className}`}
      {...props}
    />
  );
}

/** A password field with a show/hide toggle. */
export function PasswordInput({
  id = "password",
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className={`relative ${className}`}>
      <TextInput
        id={id}
        type={shown ? "text" : "password"}
        className="block w-full pe-12"
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown(!shown)}
        aria-pressed={shown}
        aria-controls={id}
        aria-label={t("Show password")}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-xl text-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
      >
        <Icon name={shown ? "eye-off" : "eye"} />
      </button>
    </div>
  );
}

export function InputError({
  messages,
  className = "",
}: {
  messages?: string[];
  className?: string;
}) {
  if (!messages || messages.length === 0) return null;
  return (
    <ul className={`space-y-1 text-sm text-red-600 ${className}`}>
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
