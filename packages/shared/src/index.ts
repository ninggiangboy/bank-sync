/** JSON body of every API error response. */
export type ApiErrorBody = {
  error: {
    code: string;
    fields?: Record<string, string[]>;
  };
};
