export * from "./banks";
export * from "./enums";

/** JSON body of every API error response. `debug` is only present in development. */
export type ApiErrorBody = {
  error: {
    code: string;
    fields?: Record<string, string[]>;
    debug?: { message: string; stack?: string };
  };
};
