import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { pliegoCssVariablesResolver, pliegoTheme } from "./pliegoTheme";

export function PliegoThemeProvider({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={pliegoTheme}
      cssVariablesResolver={pliegoCssVariablesResolver}
      defaultColorScheme="auto"
    >
      {children}
    </MantineProvider>
  );
}
