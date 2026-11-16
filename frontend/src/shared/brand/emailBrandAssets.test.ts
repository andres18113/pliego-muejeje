import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Transactional emails load their logo from the storefront (`<public URL>/brand/…`), so the
// frontend release must ship every brand file the backend's email templates name.
// Vitest runs from frontend/; the backend sits beside it in the repository.
const publicFile = (path: string) => resolve(process.cwd(), "public", path.replace(/^\//, ""));
const mailLayout = readFileSync(resolve(process.cwd(), "../backend/src/main/java/com/pliego/modules/notifications/application/MailLayout.java"), "utf8");

function pngSize(path: string) {
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("email brand assets", () => {
  const referenced = [...mailLayout.matchAll(/"(\/brand\/[A-Za-z0-9._-]+\.png)"/g)].map((match) => match[1]);

  it("ships every brand image the email templates reference", () => {
    expect(referenced).toEqual(["/brand/pliego-logo-email.png"]);
    for (const path of referenced) expect(existsSync(publicFile(path)), path).toBe(true);
  });

  it("keeps the email logo sharp at its rendered size", () => {
    const rendered = mailLayout.match(/width=\\"(\d+)\\" height=\\"(\d+)\\" alt=\\"PLIEGO\\"/);
    expect(rendered).not.toBeNull();
    const [width, height] = [Number(rendered![1]), Number(rendered![2])];
    const asset = pngSize(publicFile("/brand/pliego-logo-email.png"));
    // At least 2× for high-density screens, in the same proportions as the rendered box.
    expect(asset.width).toBeGreaterThanOrEqual(width * 2);
    expect(asset.width / asset.height).toBeCloseTo(width / height, 1);
  });

  it("keeps the earlier email logo for messages already delivered", () => {
    // Emails sent before the white-plate lockup still point at this file; removing it would break them.
    expect(pngSize(publicFile("/brand/pliego-logo.png")).width).toBeGreaterThan(0);
  });
});
