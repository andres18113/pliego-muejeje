import {
  ActionIcon,
  Button,
  createTheme,
  Input,
  rem,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type MantineTheme,
} from "@mantine/core";
import classes from "./pliegoTheme.module.css";

const pliegoFontFamily = '"Roboto Flex Variable", Roboto, Arial, sans-serif';

const pliego: MantineColorsTuple = [
  "#edf3ff",
  "#dae3f4",
  "#b4c4e5",
  "#8ba4d8",
  "#6888cc",
  "#5276c5",
  "#466ec3",
  "#375dac",
  "#3157a4",
  "#21478a",
];

export const pliegoTheme = createTheme({
  colors: { pliego },
  primaryColor: "pliego",
  primaryShade: {
    light: 8,
    dark: 6,
  },
  spacing: {
    "2xs": rem(4),
    xs: rem(8),
    sm: rem(12),
    md: rem(16),
    lg: rem(24),
    xl: rem(32),
    "2xl": rem(48),
    "3xl": rem(64),
  },
  radius: {
    xs: rem(4),
    sm: rem(8),
    md: rem(12),
    lg: rem(16),
    xl: rem(24),
  },
  defaultRadius: "md",
  fontFamily: pliegoFontFamily,
  headings: {
    fontFamily: pliegoFontFamily,
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "var(--mantine-font-size-h1)", lineHeight: "var(--mantine-line-height-h1)", fontWeight: "600" },
      h2: { fontSize: "var(--mantine-font-size-h2)", lineHeight: "var(--mantine-line-height-h2)", fontWeight: "600" },
      h3: { fontSize: "var(--mantine-font-size-xl)", lineHeight: "var(--mantine-line-height-xl)", fontWeight: "600" },
      h4: { fontSize: "var(--mantine-font-size-lg)", lineHeight: "var(--mantine-line-height-lg)", fontWeight: "600" },
      h5: { fontSize: "var(--mantine-font-size-md)", lineHeight: "var(--mantine-line-height-md)", fontWeight: "400" },
      h6: { fontSize: "var(--mantine-font-size-sm)", lineHeight: "var(--mantine-line-height-sm)", fontWeight: "400" },
    },
  },
  fontSizes: {
    xs: rem(12),
    sm: rem(14),
    md: rem(16),
    lg: rem(20),
    xl: rem(24),
    display: rem(40),
    h1: rem(32),
    h2: rem(28),
  },
  lineHeights: {
    xs: rem(16),
    sm: rem(20),
    md: rem(24),
    lg: rem(28),
    xl: rem(32),
    display: rem(48),
    h1: rem(40),
    h2: rem(36),
  },
  fontWeights: {
    regular: "400",
    medium: "500",
    bold: "600",
  },
  focusClassName: classes.focusRing,
  components: {
    Button: Button.extend({
      defaultProps: {
        size: "md",
      },
      vars: (_theme, props) => ({
        root: {
          "--button-height": props.size === "md" ? rem(44) : undefined,
        },
      }),
    }),
    Input: Input.extend({
      defaultProps: {
        size: "md",
      },
      classNames: {
        input: classes.inputControl,
      },
      vars: (_theme, props) => ({
        wrapper: {
          "--input-height": props.size === "md" ? rem(44) : undefined,
        },
      }),
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        size: "xl",
      },
    }),
  },
});

type PliegoRoleKind = "surface" | "text" | "border";

interface PliegoRoleDefinition {
  label: string;
  kind: PliegoRoleKind;
  resolve: (theme: MantineTheme) => { light: string; dark: string };
}

const pliegoRoleDefinitions = {
  background: {
    label: "Background",
    kind: "surface",
    resolve: (theme) => ({ light: theme.colors.gray[0], dark: theme.colors.dark[7] }),
  },
  surface: {
    label: "Surface",
    kind: "surface",
    resolve: (theme) => ({ light: theme.white, dark: theme.colors.dark[6] }),
  },
  "surface-hover": {
    label: "Surface hover",
    kind: "surface",
    resolve: (theme) => ({ light: theme.colors.gray[1], dark: theme.colors.dark[5] }),
  },
  text: {
    label: "Text",
    kind: "text",
    resolve: (theme) => ({ light: theme.colors.gray[9], dark: theme.colors.dark[0] }),
  },
  "text-muted": {
    label: "Muted text",
    kind: "text",
    resolve: (theme) => ({ light: theme.colors.gray[7], dark: theme.colors.dark[1] }),
  },
  border: {
    label: "Border",
    kind: "border",
    resolve: (theme) => ({ light: theme.colors.gray[3], dark: theme.colors.dark[4] }),
  },
  "control-border": {
    label: "Control border",
    kind: "border",
    resolve: (theme) => ({ light: theme.colors.gray[6], dark: theme.colors.dark[2] }),
  },
} satisfies Record<string, PliegoRoleDefinition>;

type PliegoRoleName = keyof typeof pliegoRoleDefinitions;

export function getPliegoSemanticRoles(theme: MantineTheme) {
  return (Object.entries(pliegoRoleDefinitions) as [PliegoRoleName, PliegoRoleDefinition][]).map(([name, definition]) => ({
    ...definition,
    name,
    token: `--pliego-${name}`,
    ...definition.resolve(theme),
  }));
}

export const pliegoCssVariablesResolver: CSSVariablesResolver = (theme) => {
  const roles = getPliegoSemanticRoles(theme);

  return {
    variables: {},
    light: Object.fromEntries(roles.map(({ token, light }) => [token, light])),
    dark: Object.fromEntries(roles.map(({ token, dark }) => [token, dark])),
  };
};
