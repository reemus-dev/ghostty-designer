import {describe, expect, it} from "bun:test";
import {liveIntents} from "./live";
import type {Intent} from "./types";

const MS = 20;
const set = (value: string): Intent => ({
  type: "set",
  key: "background",
  values: [value],
});
const palette = (entry: string): Intent => ({
  type: "set",
  key: "palette",
  values: [entry],
});
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Live intents over a `run` that records what applies, in order. */
function setup() {
  const applied: Intent[] = [];
  const live = liveIntents((intent) => {
    applied.push(intent);
    return Promise.resolve();
  }, MS);
  return {applied, live};
}

describe("liveIntents", () => {
  it("applies the first at once and the last after the pause", async () => {
    const {applied, live} = setup();
    void live.offer(set("#111111"));
    void live.offer(set("#222222"));
    const last = live.offer(set("#333333"));
    expect(applied).toEqual([set("#111111")]);
    await last;
    expect(applied).toEqual([set("#111111"), set("#333333")]);
  });

  it("resolves an intent a later one replaces at once", async () => {
    const {applied, live} = setup();
    void live.offer(set("#111111"));
    const replaced = live.offer(set("#222222"));
    void live.offer(set("#333333"));
    await replaced;
    expect(applied).toEqual([set("#111111")]);
  });

  it("keeps a slot per palette index", async () => {
    const {applied, live} = setup();
    void live.offer(palette("1=#111111"));
    const one = live.offer(palette("1=#222222"));
    const two = live.offer(palette("2=#333333"));
    await Promise.all([one, two]);
    expect(applied).toEqual([
      palette("1=#111111"),
      palette("2=#333333"),
      palette("1=#222222"),
    ]);
  });

  it("applies the waiting intents before a request after a flush", async () => {
    const {applied, live} = setup();
    void live.offer(set("#111111"));
    void live.offer(set("#222222"));
    live.flush();
    applied.push({type: "reset", key: "background"});
    await later(MS * 2);
    expect(applied).toEqual([
      set("#111111"),
      set("#222222"),
      {type: "reset", key: "background"},
    ]);
  });
});
