import type { ComponentPropsWithRef } from "react";

/** Keep raw edits visible: validation rejects malformed values instead of silently changing identity. */
export function EcuadorianCedulaInput(props: ComponentPropsWithRef<"input">) {
  return <input autoComplete="off" {...props} type="text" inputMode="numeric" />;
}
