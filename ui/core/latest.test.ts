import {expect, it} from "bun:test";
import {latestLoads} from "./latest";

/** Loads the test answers by hand, in the order they started. */
function setup() {
  const loads: PromiseWithResolvers<string>[] = [];
  const waited: string[][] = [];
  const kept: [result: string | Error, answered: string[], latest: boolean][] =
    [];
  const latest = latestLoads<string, string>(
    (waiting) => {
      waited.push([...waiting]);
      const load = Promise.withResolvers<string>();
      loads.push(load);
      return load.promise;
    },
    (result, answered, isLatest) => {
      kept.push([result, answered, isLatest]);
      return result instanceof Error ? result : null;
    },
  );
  return {latest, loads, waited, kept};
}

/** Why a request failed, or null once it is answered. */
const failure = (request: Promise<void>) =>
  request.then(() => null).catch((error: unknown) => (error as Error).message);

/** Lets every settled load reach `keep`. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

it("drops a result older than one already kept", async () => {
  const {latest, loads, kept} = setup();
  latest.start();
  latest.start();
  loads[1]!.resolve("new");
  loads[0]!.resolve("old");
  await flush();
  expect(kept).toEqual([["new", [], true]]);
});

it("answers a request with the first load started for it, then keeps the latest", async () => {
  const {latest, loads, kept} = setup();
  const request = latest.request("settle");
  latest.start();
  loads[0]!.resolve("first");
  await request;
  loads[1]!.resolve("second");
  await flush();
  expect(kept).toEqual([
    ["first", ["settle"], false],
    ["second", [], true],
  ]);
});

it("never answers a request with a load started before it", async () => {
  const {latest, loads, kept} = setup();
  latest.start();
  const answered: string[] = [];
  void latest.request("settle").then(() => {
    answered.push("settle");
  });
  loads[0]!.resolve("before");
  await flush();
  expect(kept).toEqual([]);
  expect(answered).toEqual([]);

  loads[1]!.resolve("after");
  await flush();
  expect(kept).toEqual([["after", ["settle"], true]]);
  expect(answered).toEqual(["settle"]);
});

it("counts a failure only from the latest load, and rejects its requests", async () => {
  const {latest, loads, kept} = setup();
  latest.start();
  const request = latest.request("load");
  loads[0]!.reject(new Error("older"));
  loads[1]!.reject(new Error("latest"));
  expect(await failure(request)).toBe("latest");
  expect(kept.map(([result]) => (result as Error).message)).toEqual(["latest"]);
});

it("rejects a request whose answer throws", async () => {
  const {latest, loads} = setup();
  const request = latest.request("install", () => {
    throw new Error("not loaded");
  });
  loads[0]!.resolve("loaded");
  expect(await failure(request)).toBe("not loaded");
});

it("starts each load with the kinds of the requests waiting", () => {
  const {latest, waited} = setup();
  void latest.request("settle");
  latest.start();
  expect(waited).toEqual([["settle"], ["settle"]]);
});
