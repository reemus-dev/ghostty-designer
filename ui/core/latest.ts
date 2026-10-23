import {asError} from "./errors";

type Waiter<K> = {
  /** The first load that can answer it. */
  first: number;
  kind: K;
  answer: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
};

/**
 * Loads that may overlap, such as reads of the config after each change to its
 * files. Loads are numbered as they start. A result counts when it is newer
 * than the last one kept and is either the latest started or the first one a
 * waiting request can take. A failure counts only from the latest.
 *
 * `load` starts a load. `keep` receives each result that counts, the kinds of
 * the requests it answers, and whether it is the latest. It returns the failure
 * those requests get, or null to answer them.
 */
export function latestLoads<T, K>(
  load: () => Promise<T>,
  keep: (result: T | Error, answered: K[], latest: boolean) => Error | null,
) {
  let started = 0;
  let kept = 0;
  let waiters: Waiter<K>[] = [];

  const settle = (number: number, result: T | Error) => {
    const latest = number === started;
    const failed = result instanceof Error;
    const answers = waiters.some((waiter) => waiter.first <= number);
    const counts = failed ? latest : number > kept && (latest || answers);
    if (!counts) return;

    if (!failed) kept = number;
    const due = waiters.filter((waiter) => waiter.first <= number);
    waiters = waiters.filter((waiter) => waiter.first > number);
    const failure = keep(
      result,
      due.map((waiter) => waiter.kind),
      latest,
    );
    for (const waiter of due) {
      if (failure) {
        waiter.reject(failure);
        continue;
      }
      try {
        waiter.answer();
        waiter.resolve();
      } catch (error) {
        waiter.reject(asError(error));
      }
    }
  };

  const start = () => {
    const number = ++started;
    void load()
      .catch((error: unknown) => asError(error))
      .then((result) => settle(number, result));
  };

  return {
    /** Starts a load that answers no request. */
    start,

    /**
     * Starts a load, and resolves once a result answers `kind`. `answer` runs
     * as that result is kept, before any later one; an error it throws
     * rejects.
     */
    request(kind: K, answer: () => void = () => {}) {
      return new Promise<void>((resolve, reject) => {
        waiters.push({first: started + 1, kind, answer, resolve, reject});
        start();
      });
    },
  };
}
