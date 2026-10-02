import type { DefaultMantineSize } from "@mantine/core";

type PliegoCustomTypographySize = "display" | "h1" | "h2";
type PliegoCustomSpacing = "2xs" | "2xl" | "3xl";

declare module "@mantine/core" {
  export interface MantineThemeSizesOverride {
    spacing: Record<DefaultMantineSize | PliegoCustomSpacing, string>;
    fontSizes: Record<DefaultMantineSize | PliegoCustomTypographySize, string>;
    lineHeights: Record<DefaultMantineSize | PliegoCustomTypographySize, string>;
  }
}

export {};
