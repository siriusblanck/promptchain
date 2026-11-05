import { expect, it } from "vitest";
import { moveStep } from "@/lib/chains/order";

it("moves step 2 to step 1 without mutating the input", () => {
  const ids = ["a", "b", "c"];
  expect(moveStep(ids, 1, 0)).toEqual(["b", "a", "c"]);
  expect(ids).toEqual(["a", "b", "c"]);
});

it("moves the first step to the end", () => expect(moveStep(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]));

it.each([[-1, 0], [0, 3], [3, 0], [1, 1]])("returns an unchanged copy for move %i → %i", (from, to) => {
  const ids = ["a", "b", "c"];
  const out = moveStep(ids, from, to);
  expect(out).toEqual(ids);
  expect(out).not.toBe(ids);
});
