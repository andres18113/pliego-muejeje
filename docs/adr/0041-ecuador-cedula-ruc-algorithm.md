# ADR-0041: Full cédula and RUC algorithm, validated live

Date: 2026-10-21. Status: accepted. Extends [ADR-0040](0040-required-correctable-cedula.md) and supersedes ADR-0037's decision not to validate the province code.

## Decision

The billing identification is a **cédula** or a **RUC**. Its kind follows from the complete number: 10 digits are a cédula, 13 a RUC. PostgreSQL (`fn_is_valid_ec_identification`), Java (`EcuadorianIdentification`) and React (`shared/validation/identification.ts`) apply the same algorithm and are checked against `shared/validation/ec-identification-cases.json`:

- **Cédula:** 10 digits, not all equal; province 01–24 or 30 (Ecuadorians abroad); third digit 0–5; modulo 10 check digit (weights 2,1,2,1,2,1,2,1,2).
- **Natural-person RUC** (third digit 0–5): a valid cédula followed by an establishment 001–999.
- **Public-sector RUC** (third digit 6): modulo 11 with weights 3,2,7,6,5,4,3,2; the check digit is digit 9 and the establishment is 0001–9999.
- **Private-company RUC** (third digit 9): modulo 11 with weights 4,3,2,7,6,5,4,3,2; the check digit is digit 10 and the establishment is 001–999.

Only external ASCII spaces are trimmed. This is algorithm validity only: it does not claim that the number exists, is active at the SRI, or who owns it. The read-back confirmation and the re-authenticated correction of ADR-0040 therefore still apply. A correction may switch between cédula and RUC; the audit keeps the previous kind.

**Input.** The field (`EcuadorianCedulaInput`) accepts digits only, at most 13 (`maxLength` 13, numeric keyboard). Any edit that would break that — keystroke, paste, drop or autofill — is rejected as a whole: the accepted value stays as it was, it is never silently truncated, and the status line explains why until the next accepted edit. A pasted number keeps its digits and only loses the spaces, dots and dashes used to format it. A read-only field intercepts nothing.

**Live validation.** While the customer types, the field judges each fact as soon as it can (digits only, province, third digit, check digit, establishment) and counts what it cannot judge yet ("faltan N dígitos") without calling it an error. Leaving the field or submitting gives the final verdict, which stays until the next edit. One message per field; screen readers hear only verdicts (an error or a valid number), never every keystroke.

**Invoice.** A cédula is issued as `NATIONAL_ID` (SRI code 05) and a RUC as `TAX_ID` (SRI code 04); the PDF labels it "Cédula" or "RUC".

**Compatibility.** `fn_is_valid_ec_cedula` (V071) is unchanged to preserve history. Numbers stored before V075 that passed modulo 10 but not the full algorithm (for example province 00) are kept and shown (`NOT VALID` constraints); checkout rejects them and the customer corrects them in Mi perfil. Every new or corrected value satisfies the full algorithm.

## Known limit

Some recently issued private-company RUCs do not satisfy the classic modulo 11. Accepting them correctly requires asking the SRI, not relaxing the algorithm without evidence; that is out of the academic scope.
