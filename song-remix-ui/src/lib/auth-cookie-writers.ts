const WRITER_TIMEOUT_MS = 5_000;

export type AuthIntent = number;

let latestIntent = 0;
let activeWriter: AbortController | null = null;
let writerTail: Promise<void> = Promise.resolve();

/** Start a new explicit authentication action and abort an older in-flight writer. */
export function beginAuthIntent(): AuthIntent {
  latestIntent += 1;
  activeWriter?.abort(new DOMException("Authentication intent was superseded", "AbortError"));
  return latestIntent;
}

/** Return whether this form or refresh still represents the latest auth intent. */
export function isAuthIntentCurrent(intent: AuthIntent): boolean {
  return intent === latestIntent;
}

/** Read the current authentication intent for a session refresh or logout cleanup. */
export function currentAuthIntent(): AuthIntent {
  return latestIntent;
}

/** Run one shared-cookie writer in order, holding admission through body settlement. */
export function runAuthCookieWriter<T>(
  intent: AuthIntent,
  callerSignal: AbortSignal | undefined,
  alwaysRun: boolean,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const result = writerTail.then(async () => {
    if (!alwaysRun && !isAuthIntentCurrent(intent)) {
      throw new DOMException("Authentication intent was superseded", "AbortError");
    }

    const controller = new AbortController();
    activeWriter = controller;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = window.setTimeout(() => {
      controller.abort(new DOMException("Authentication request timed out", "TimeoutError"));
    }, WRITER_TIMEOUT_MS);

    try {
      return await operation(controller.signal);
    } finally {
      window.clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
      if (activeWriter === controller) activeWriter = null;
    }
  });
  writerTail = result.then(() => undefined, () => undefined);
  return result;
}
