import { describe, expect, it } from "vitest";
import cases from "../../../../shared/validation/person-cases.json";
import { normalizePersonName, personNameError, phoneError, normalizePhonePresentation, recipientError } from "./person";

describe("shared person contract", () => {
  it.each(cases.names)("validates name '$input' using the shared repertoire", (entry) => {
    expect(personNameError(entry.input,"nombres")===null).toBe(entry.valid);
    if(entry.valid) expect(normalizePersonName(entry.input)).toBe(entry.normalized);
  });
  it.each(cases.phones)("validates phone '$input' without changing digits", (entry) => {
    expect(phoneError(entry.input)===null).toBe(entry.valid);
    if(entry.valid) expect(normalizePhonePresentation(entry.input)).toBe(entry.normalized);
  });
  it("counts supplementary letters by code point and retains the compatible recipient limit", () => {
    expect(personNameError("𐐀".repeat(120),"nombres")).toBeNull();
    expect(personNameError("A\u030a\u0301".repeat(120),"nombres")).toBeNull();
    expect(personNameError("𐐀".repeat(121),"nombres")).toBe("Tus nombres no pueden superar 120 caracteres.");
    expect(recipientError("𐐀".repeat(120)+" "+"李".repeat(120))).toBeNull();
    expect(recipientError("A".repeat(242))).toBe("El destinatario no puede superar 241 caracteres.");
  });
});
