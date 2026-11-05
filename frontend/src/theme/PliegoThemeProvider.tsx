import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { pliegoCssVariablesResolver, pliegoTheme } from "./pliegoTheme";

export function PliegoThemeProvider({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={pliegoTheme}
      cssVariablesResolver={pliegoCssVariablesResolver}
      // PLIEGO has one appearance: its light paper scheme, whatever the system or browser prefers.
      defaultColorScheme="light"
      forceColorScheme="light"
    >
      {children}
    </MantineProvider>
  );
}
