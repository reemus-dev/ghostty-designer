import type {CommandError} from "@/core/bindings";

/**
 * A failed session or host call. `input` refuses a request and says why.
 * `internal` is an operation that failed, such as a read or a write.
 */
export class SessionError extends Error {
  constructor(
    message: string,
    readonly kind: CommandError["kind"],
  ) {
    super(message);
  }
}

/** Refuses a request, saying why. */
export const inputError = (message: string) =>
  new SessionError(message, "input");

export const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

export const errorText = (error: unknown) => asError(error).message;
