import sharedCases from "../../../../shared/validation/cedula-cases.json";
import { describe, expect, it } from "vitest";
import { ecuadorianCedulaError, isValidEcuadorianCedula } from "./cedula";

describe("cédula: formato y dígito verificador, sin afirmar titularidad", () => {
  it.each(["0123456782", "1234567897", " 0123456782 "])("accepts synthetic checksum fixture %# without losing initial zero", value => {
    expect(isValidEcuadorianCedula(value)).toBe(true);
    expect(ecuadorianCedulaError(value)).toBeNull();
  });
  it.each([null, undefined, "", "0000000000", "1111111111", "012345678", "01234567822", "0123456783", "01234 6782", "+123456789", "12345678.9", "012345678x", "０１２３４５６７８２"])("rejects malformed or invalid checksum fixture %#", value => {
    expect(isValidEcuadorianCedula(value)).toBe(false);
    expect(ecuadorianCedulaError(value)).toBeTruthy();
  });
});

it.each(sharedCases.cases)("matches shared synthetic case $id", fixture => { expect(isValidEcuadorianCedula(fixture.input)).toBe(fixture.valid); });
