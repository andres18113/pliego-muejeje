/** Checks format/checksum only; it does not verify the holder or province of issue. */
export function isValidEcuadorianCedula(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const number = value.replace(/^ +| +$/g, "");
  if (!/^[0-9]{10}$/.test(number) || /^(\d)\1{9}$/.test(number)) return false;
  let sum = 0;
  for (let index = 0; index < 9; index++) {
    const product = Number(number[index]) * (index % 2 === 0 ? 2 : 1);
    sum += product > 9 ? product - 9 : product;
  }
  return (10 - sum % 10) % 10 === Number(number[9]);
}
export const cedulaValidationMessage = "Ingresa una cédula ecuatoriana válida de 10 dígitos";
export function ecuadorianCedulaError(value: unknown): string | null {
  return isValidEcuadorianCedula(value) ? null : cedulaValidationMessage;
}
