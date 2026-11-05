import { z } from "zod";

const localReturnPath=z.string().max(2048).refine(value => {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url=new URL(value,"https://pliego.invalid");
    return url.origin==="https://pliego.invalid" && /^\/(?:catalog(?:\/editions\/[1-9][0-9]{0,18})?|ofertas|favorites|cart|checkout|account(?:\/addresses)?|(?:orders|biblioteca)(?:\/[1-9][0-9]{0,18})?)?\/?$/.test(value.split(/[?#]/,1)[0]);
  } catch { return false; }
});

/** Runtime validation for the additive LoginResponse + sanitized returnTo contract. */
export const registrationSessionSchema=z.object({
  accessToken:z.string().min(1),tokenType:z.literal("Bearer"),expiresInSeconds:z.number().int().positive(),
  user:z.object({userId:z.string().regex(/^[1-9][0-9]*$/),email:z.email(),role:z.literal("CUSTOMER")}),
  returnTo:localReturnPath.nullable(),
});
export const registrationSessionStateSchema=z.object({state:z.enum(["PENDING_VERIFICATION","REFRESH_REQUIRED","RETRY_LATER"])});
export type RegistrationSession=z.infer<typeof registrationSessionSchema>;
export type RegistrationSessionState=z.infer<typeof registrationSessionStateSchema>;
