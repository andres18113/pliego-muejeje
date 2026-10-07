import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Disposable PG18 fixtures confirm through the real public email-verification endpoint. */
export function verifyRegisteredEmail(email: string, apiOrigin: string) {
  execFileSync("python3", ["-c", "import sys; sys.path.insert(0, sys.argv[1]); from email_verification_fixture import verify_registered_email; verify_registered_email(sys.argv[2], sys.argv[3])",
    fileURLToPath(new URL("../../../../backend/src/test/postgres18/", import.meta.url)), email, apiOrigin.replace(/\/api\/v1$/, "")],
  { env: process.env, stdio: "pipe" });
}
