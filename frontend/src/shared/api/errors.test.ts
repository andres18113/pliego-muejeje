import { describe, expect, it } from "vitest";
import { ApiRequestError, describeApiError, fieldErrorMessages, toApiRequestError } from "./errors";

describe("toApiRequestError", () => {
  it("preserves every valid server field violation in its original order", () => {
    const error = toApiRequestError(400, {
      code: "VALIDATION_ERROR",
      title: "Datos inválidos",
      detail: "Revisa los campos indicados.",
      traceId: "trace-validation",
      violations: [
        { field: "email", message: "Introduce un correo válido." },
        { field: "password", message: "La contraseña es demasiado corta." },
        { field: "email", message: "Este correo no está permitido." },
        { field: "email", message: "Introduce un correo válido." },
      ],
    }, "No pudimos guardar", "Inténtalo otra vez.");

    expect(error).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      title: "Datos inválidos",
      detail: "Revisa los campos indicados.",
      traceId: "trace-validation",
      violations: [
        { field: "email", message: "Introduce un correo válido." },
        { field: "password", message: "La contraseña es demasiado corta." },
        { field: "email", message: "Este correo no está permitido." },
        { field: "email", message: "Introduce un correo válido." },
      ],
    });
  });

  it("discards malformed violations and never exposes rejected values", () => {
    const error = toApiRequestError(400, {
      violations: [
        null, undefined, false, 4, "email", [], {},
        { field: 7, message: "Datos inválidos." },
        { field: "email", message: 2 },
        { field: " \n", message: "Datos inválidos." },
        { field: "email", message: " \n" },
        { field: "email", message: "Introduce un correo válido.", value: "secret", rejectedValue: "secret" },
        { field: "phoneNumber", message: "Revisa el número de teléfono." },
      ],
    }, "No pudimos guardar", "Inténtalo otra vez.");

    expect(error.violations).toEqual([
      { field: "email", message: "Introduce un correo válido." },
      { field: "phoneNumber", message: "Revisa el número de teléfono." },
    ]);
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it.each([undefined, null, "email", 4, false, { field: "email", message: "Datos inválidos." }])(
    "ignores violations that are not an array (%j)", (violations) => {
      const error = toApiRequestError(400, { violations }, "No pudimos guardar", "Inténtalo otra vez.");
      expect(error.violations).toEqual([]);
    },
  );

  it("uses the supplied fallback for an unknown problem body", () => {
    const error = toApiRequestError(502, null, "No pudimos guardar", "Inténtalo otra vez.");
    expect(describeApiError(error)).toEqual({
      title: "No pudimos guardar",
      detail: "Inténtalo otra vez.",
      code: undefined,
      status: 502,
    });
    expect(error.violations).toEqual([]);
  });
});

describe("fieldErrorMessages", () => {
  it("returns unique messages for exactly the requested server field in order", () => {
    const error = toApiRequestError(400, {
      violations: [
        { field: "email", message: "Introduce un correo válido." },
        { field: "password", message: "La contraseña es demasiado corta." },
        { field: "email", message: "Este correo no está permitido." },
        { field: "email", message: "Introduce un correo válido." },
      ],
    }, "Datos inválidos", "Revisa los campos.");

    expect(fieldErrorMessages(error, "email")).toBe("Introduce un correo válido. Este correo no está permitido.");
    expect(fieldErrorMessages(error, "password")).toBe("La contraseña es demasiado corta.");
  });

  it("never guesses another field from a validation code or matching detail", () => {
    const error = toApiRequestError(400, {
      code: "VALIDATION_ERROR",
      detail: "Introduce un correo válido.",
      violations: [{ field: "email", message: "Introduce un correo válido." }],
    }, "Datos inválidos", "Revisa los campos.");

    expect(fieldErrorMessages(error, "phoneNumber")).toBeUndefined();
    expect(fieldErrorMessages(error, "Email")).toBeUndefined();
    expect(fieldErrorMessages(error, " email ")).toBeUndefined();
  });

  it("supports callers using the existing constructor without violations", () => {
    const error = new ApiRequestError(409, "EMAIL_ALREADY_REGISTERED", "Correo registrado", "Este correo ya tiene una cuenta.", "trace-existing");

    expect(fieldErrorMessages(error, "email")).toBeUndefined();
    expect(error.traceId).toBe("trace-existing");
    expect(describeApiError(error)).toEqual({
      title: "Correo registrado",
      detail: "Este correo ya tiene una cuenta.",
      code: "EMAIL_ALREADY_REGISTERED",
      status: 409,
    });
  });

  it("accepts violations as the optional last constructor argument", () => {
    const error = new ApiRequestError(400, "VALIDATION_ERROR", "Datos inválidos", "Revisa los campos.", undefined,
      [{ field: "email", message: "Introduce un correo válido." }]);
    expect(fieldErrorMessages(error, "email")).toBe("Introduce un correo válido.");
  });

  it.each([undefined, null, new Error("internal database failure"), { violations: [{ field: "email", message: "Datos inválidos." }] }])(
    "returns no field messages for an unknown failure (%j)", (error) => {
      expect(fieldErrorMessages(error, "email")).toBeUndefined();
      expect(describeApiError(error)).toEqual({
        title: "No pudimos completar la solicitud",
        detail: "Comprueba tu conexión e inténtalo otra vez.",
        code: undefined,
        status: undefined,
      });
    },
  );
});
