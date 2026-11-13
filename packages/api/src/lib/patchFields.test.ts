import { describe, expect, it } from "vitest";
import { UpdateUserSchema } from "@holidoginn/shared";

import { pickSentKeys } from "./patchFields";

describe("pickSentKeys", () => {
  it("no deja pasar los defaults del schema de alta", () => {
    const body = { firstName: "Andrea" };
    const parsed = UpdateUserSchema.parse(body);
    expect(parsed.role).toBe("OWNER"); // el problema: zod lo rellena
    expect(pickSentKeys(parsed, body)).toEqual({ firstName: "Andrea" });
  });

  it("respeta lo que sí vino, incluido null", () => {
    const body = { isActive: false, phone: null };
    expect(pickSentKeys(UpdateUserSchema.parse(body), body)).toEqual({
      isActive: false,
      phone: null,
    });
  });

  it("body vacío o raro → nada", () => {
    expect(pickSentKeys({ role: "OWNER" }, undefined)).toEqual({});
    expect(pickSentKeys({ role: "OWNER" }, "x")).toEqual({});
  });
});
