import { expect, it } from "vitest";
import { describeTrail, pad2, ratioOf, snippet, tileColor } from "@/lib/chains/presentation";

it("cycles tile colors", () => expect([0, 1, 2, 3, 4].map(tileColor)).toEqual(["cyan", "lime", "orange", "mint", "cyan"]));
it("pads step numbers", () => expect(pad2(2)).toBe("02"));
it("shortens long text on one line", () => expect(snippet("a\n b   c", 4)).toBe("a b…"));
it("describes the modality trail", () => {
  expect(describeTrail(["text", "image"])).toBe("2 steps · text → image");
  expect(describeTrail(["text", "text", "text"])).toBe("3 steps · text");
  expect(describeTrail([])).toBe("No steps yet");
});
it("uses stored dimensions or 3:4", () => {
  expect(ratioOf({ url: "u", width: 1600, height: 900 })).toBe("1600 / 900");
  expect(ratioOf({ url: "u", width: null, height: null })).toBe("3 / 4");
});
