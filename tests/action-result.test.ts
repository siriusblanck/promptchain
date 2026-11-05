import { expect, it } from "vitest";
import { z } from "zod";
import { fail, fieldErrorsOf, ok } from "@/lib/action-result";

it("wraps success and failure", () => {
  expect(ok(5)).toEqual({ ok: true, data: 5 });
  expect(fail("Nope")).toEqual({ ok: false, error: "Nope" });
});

it("keeps the first zod message per field", () => {
  const parsed = z.object({ name: z.string().min(1, "Name is required") }).safeParse({ name: "" });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(fieldErrorsOf(parsed.error)).toEqual({ name: "Name is required" });
});
