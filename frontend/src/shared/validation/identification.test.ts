import sharedCases from "../../../../shared/validation/ec-identification-cases.json";
import { describe, expect, it } from "vitest";
import { identificationError, identificationType, isValidIdentification, liveIdentificationCheck } from "./identification";

describe("cédula y RUC: algoritmo, sin afirmar existencia ni titularidad", () => {
  it.each(sharedCases.cases)("matches shared synthetic case $id", fixture => {
    expect(isValidIdentification(fixture.type, fixture.input)).toBe(fixture.valid);
  });

  it.each(sharedCases.cases.filter(fixture => typeof fixture.input === "string" && identificationType(fixture.input) === fixture.type))(
    "never contradicts the final verdict while typing ($id)", fixture => {
      const live = liveIdentificationCheck(fixture.input!);
      expect(live.tone === "success").toBe(fixture.valid);
      expect(identificationError(fixture.input!) === null).toBe(fixture.valid);
    });

  it("judges each digit as soon as it can, and only counts what it cannot judge yet", () => {
    expect(liveIdentificationCheck("")).toMatchObject({ tone: "help", message: "Cédula: 10 dígitos. RUC: 13 dígitos." });
    expect(liveIdentificationCheck("1")).toMatchObject({ tone: "help", message: "Cédula: faltan 9 dígitos. RUC: faltan 12 dígitos." });
    expect(liveIdentificationCheck("25").tone).toBe("error");
    expect(liveIdentificationCheck("00").message).toBe("Los dos primeros dígitos deben ser una provincia: del 01 al 24, o 30.");
    expect(liveIdentificationCheck("177").message).toBe("El tercer dígito no corresponde a una cédula ni a un RUC.");
    expect(liveIdentificationCheck("171003406")).toMatchObject({ tone: "help", message: "Cédula: falta 1 dígito.", type: "EC_CEDULA" });
    expect(liveIdentificationCheck("1710034065")).toMatchObject({ tone: "success", message: "Cédula válida.", type: "EC_CEDULA" });
    expect(liveIdentificationCheck("1710034066")).toMatchObject({ tone: "error", message: "El dígito verificador no coincide. Revisa los números." });
    expect(liveIdentificationCheck("17100340650")).toMatchObject({ tone: "help", message: "RUC: faltan 2 dígitos.", type: "EC_RUC" });
    expect(liveIdentificationCheck("1710034065001")).toMatchObject({ tone: "success", message: "RUC de persona natural válido." });
    expect(liveIdentificationCheck("1710034065000").message).toBe("El establecimiento del RUC no puede ser 000.");
    expect(liveIdentificationCheck("1790016919")).toMatchObject({ tone: "help", message: "RUC de sociedad: faltan 3 dígitos." });
    expect(liveIdentificationCheck("1790016918").message).toBe("El dígito verificador del RUC no coincide. Revisa los números.");
    expect(liveIdentificationCheck("1760001200001")).toMatchObject({ tone: "success", message: "RUC de entidad pública válido." });
    expect(liveIdentificationCheck("1760001200000").message).toBe("El establecimiento del RUC no puede ser 0000.");
    expect(liveIdentificationCheck("17100-3").message).toBe("Usa solo números, sin espacios ni guiones.");
    expect(liveIdentificationCheck("17100340650011").message).toBe("Sobran dígitos: la cédula tiene 10 y el RUC 13.");
  });

  it("gives one final message for empty or incomplete values", () => {
    expect(identificationError("")).toBe("Escribe tu cédula o RUC.");
    expect(identificationError("171003")).toBe("Completa la cédula (10 dígitos) o el RUC (13 dígitos).");
    expect(identificationError(" 1710034065 ")).toBeNull();
  });
});
