import {expect, it} from "bun:test";
import {siblingOf} from "./theme-library";

const THEMES = [
  {name: "Rose Pine Moon", dark: true},
  {name: "Rose Pine Dawn", dark: false},
  {name: "GitHub Dark Default", dark: true},
  {name: "GitHub Dark Dimmed", dark: true},
  {name: "GitHub Light Default", dark: false},
  {name: "GitHub Light High Contrast", dark: false},
  {name: "Dracula", dark: true},
  {name: "Solarized Dark", dark: true},
];

const sibling = (name: string) =>
  siblingOf(
    THEMES.find((theme) => theme.name === name)!,
    THEMES,
  )?.name;

it("picks the opposite-mode theme sharing the most leading name words", () => {
  expect(sibling("Rose Pine Moon")).toBe("Rose Pine Dawn");
  expect(sibling("Rose Pine Dawn")).toBe("Rose Pine Moon");
  expect(sibling("GitHub Dark Default")).toBe("GitHub Light Default");
  expect(sibling("GitHub Light Default")).toBe("GitHub Dark Default");
});

it("finds no sibling without an opposite-mode theme sharing the first word", () => {
  expect(sibling("Dracula")).toBeUndefined();
  expect(sibling("Solarized Dark")).toBeUndefined();
});
