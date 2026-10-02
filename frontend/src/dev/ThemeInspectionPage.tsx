import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Chip,
  Container,
  Grid,
  Group,
  NumberInput,
  Paper,
  PasswordInput,
  Pill,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Title,
  Text,
  TextInput,
  useComputedColorScheme,
  useMantineColorScheme,
  useMantineTheme,
  type MantineColorScheme,
} from "@mantine/core";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { getPliegoSemanticRoles } from "@/theme/pliegoTheme";
import classes from "./ThemeInspectionPage.module.css";
import { BookCardDiagnostic } from "./BookCardDiagnostic";
import { StockStatusDiagnostic } from "./StockStatusDiagnostic";

const schemes: { value: MantineColorScheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

const semanticTokens = [
  { token: "--mantine-color-body", label: "Body background", kind: "surface" },
  { token: "--mantine-color-text", label: "Body text", kind: "text" },
  { token: "--mantine-color-dimmed", label: "Dimmed text", kind: "text" },
  { token: "--mantine-color-default", label: "Default surface", kind: "surface" },
  { token: "--mantine-color-default-hover", label: "Default hover", kind: "surface" },
  { token: "--mantine-color-default-color", label: "Default text", kind: "text" },
  { token: "--mantine-color-default-border", label: "Default border", kind: "border" },
  { token: "--mantine-color-disabled", label: "Disabled surface", kind: "surface" },
  { token: "--mantine-color-disabled-color", label: "Disabled text", kind: "text" },
  { token: "--mantine-color-disabled-border", label: "Disabled border", kind: "border" },
  { token: "--mantine-color-placeholder", label: "Placeholder", kind: "text" },
  { token: "--mantine-color-error", label: "Error", kind: "text" },
  { token: "--mantine-color-success", label: "Success", kind: "text" },
] as const;

const primaryTokens = [
  { token: "--mantine-primary-color-filled", label: "Filled", kind: "surface" },
  { token: "--mantine-primary-color-filled-hover", label: "Filled hover", kind: "surface" },
  { token: "--mantine-primary-color-light", label: "Light", kind: "surface" },
  { token: "--mantine-primary-color-light-hover", label: "Light hover", kind: "surface" },
  { token: "--mantine-primary-color-light-color", label: "Light text", kind: "text" },
  { token: "--mantine-color-pliego-outline", label: "Outline", kind: "text" },
  { token: "--mantine-color-pliego-outline-hover", label: "Outline hover", kind: "surface" },
] as const;

const neutralScales = [
  { name: "gray", label: "Gray", values: "gray" },
  { name: "dark", label: "Dark", values: "dark" },
] as const;

const spacingTokens = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
const radiusTokens = ["xs", "sm", "md", "lg", "xl"] as const;
const shadowTokens = ["xs", "sm", "md", "lg", "xl"] as const;

export function ThemeInspectionPage() {
  const theme = useMantineTheme();
  const pliegoRoles = getPliegoSemanticRoles(theme);
  const pliegoSurfaceRole = pliegoRoles.find((role) => role.name === "surface")!;
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");

  useEffect(() => {
    document.title = "Theme inspection · PLIEGO";
  }, []);

  return (
    <main className={classes.page}>
      <div className={classes.content}>
        <header className={classes.header}>
          <div className={classes.heading}>
            <Badge color="pliego" variant="light" leftSection={<MaterialSymbol name="format_paint" size={15} />}>
              Development only
            </Badge>
            <Title order={1} className={classes.title}>PLIEGO design system</Title>
            <Text size="sm" lh="sm" className={`${classes.intro} ${classes.mutedText}`}>
              A diagnostic view of PLIEGO’s approved foundations and responsive layout candidates.
              Change the color scheme or resize the viewport to inspect rendered values.
            </Text>
          </div>

          <div className={classes.schemeControl}>
            <Text size="sm" fw={600}>Color scheme</Text>
            <SegmentedControl
              aria-label="Color scheme"
              value={colorScheme}
              onChange={(value) => setColorScheme(value as MantineColorScheme)}
              data={schemes}
            />
            <Text size="xs" c="dimmed">Active: {computedColorScheme}</Text>
          </div>
        </header>

        <section className={classes.section} aria-labelledby="brand-scale-title">
          <SectionHeading id="brand-scale-title" eyebrow="01 / Brand" title="PLIEGO scale" />
          <div className={classes.colorGrid}>
            {theme.colors.pliego.map((value, index) => (
              <ColorTile key={value} index={index} name={`pliego.${index}`} value={value} color={value} />
            ))}
          </div>
        </section>

        <section className={classes.section} aria-labelledby="neutral-scale-title">
          <SectionHeading id="neutral-scale-title" eyebrow="02 / Neutrals" title="Mantine native neutral scales" />
          <div className={classes.neutralScales}>
            {neutralScales.map((scale) => {
              const values = theme.colors[scale.values];
              return (
                <div className={classes.neutralScale} key={scale.name}>
                  <Text component="h3" size="sm" fw={600} className={classes.scaleTitle}>{scale.label}</Text>
                  <div className={classes.colorGrid}>
                    {values.map((value, index) => (
                      <ColorTile key={value} index={index} name={`${scale.name}.${index}`} value={value} color={value} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={classes.section} aria-labelledby="semantic-colors-title">
          <SectionHeading
            id="semantic-colors-title"
            eyebrow="03 / Active CSS variables"
            title="Semantic colors"
            detail="Each preview consumes the live Mantine variable. The displayed value is read from the rendered CSS."
          />
          <div className={classes.semanticGrid}>
            {semanticTokens.map((item) => (
              <VariableTile key={item.token} token={item.token} label={item.label} kind={item.kind} />
            ))}
          </div>
        </section>

        <section className={classes.section} aria-labelledby="pliego-semantic-roles-title">
          <SectionHeading
            id="pliego-semantic-roles-title"
            eyebrow="04 / PLIEGO aliases"
            title="PLIEGO semantic roles"
            detail="Each role resolves from Mantine’s native gray, dark, and white values. Both schemes are shown together."
          />
          <div className={classes.roleGrid}>
            {pliegoRoles.map((role) => (
              <RoleTile
                key={role.token}
                role={role}
                lightSurface={pliegoSurfaceRole.light}
                darkSurface={pliegoSurfaceRole.dark}
              />
            ))}
          </div>
        </section>

        <section className={classes.section} aria-labelledby="primary-color-title">
          <SectionHeading
            id="primary-color-title"
            eyebrow="05 / Generated variables"
            title="Primary color"
            detail="Mantine generates these variants from the PLIEGO palette and active color scheme."
          />
          <div className={classes.primaryTokens}>
            {primaryTokens.map((item) => (
              <VariableTile key={item.token} token={item.token} label={item.label} kind={item.kind} />
            ))}
          </div>

          <div className={classes.componentPanel}>
            <div className={classes.panelHeader}>
              <div>
                <Text component="h3" size="md" lh="md" fw={600} className={classes.pliegoText}>Components using PLIEGO</Text>
                <Text size="sm" lh="sm" className={classes.mutedText}>Representative Mantine states with <code>color="pliego"</code>.</Text>
              </div>
              <Badge color="pliego" leftSection={<MaterialSymbol name="check_circle" size={14} />}>Primary</Badge>
            </div>
            <div className={classes.componentExamples}>
              <div className={classes.componentExample}>
                <Text size="xs" c="dimmed">Filled button</Text>
                <Button color="pliego" leftSection={<MaterialSymbol name="menu_book" size={17} />}>Explore catalog</Button>
              </div>
              <div className={classes.componentExample}>
                <Text size="xs" c="dimmed">Light button</Text>
                <Button color="pliego" variant="light">Save for later</Button>
              </div>
              <div className={classes.componentExample}>
                <Text size="xs" c="dimmed">Outline button</Text>
                <Button color="pliego" variant="outline">View details</Button>
              </div>
              <div className={classes.componentExample}>
                <Text size="xs" c="dimmed">Action icon</Text>
                <ActionIcon color="pliego" size="lg" aria-label="Add to favorites">
                  <MaterialSymbol name="favorite_border" />
                </ActionIcon>
              </div>
              <div className={classes.componentExample}>
                <Text size="xs" c="dimmed">Badge</Text>
                <Badge color="pliego" variant="light">Available</Badge>
              </div>
              <div className={classes.componentExample}>
                <Text size="xs" c="dimmed">Switch</Text>
                <Switch color="pliego" label="Notify me" defaultChecked />
              </div>
              <div className={`${classes.componentExample} ${classes.focusedInput}`}>
                <Text size="xs" c="dimmed">Text input · focused</Text>
                <TextInput label="Search books" placeholder="Title, author, ISBN" defaultValue="The design of everyday things" autoFocus />
              </div>
              <div className={classes.componentExample}>
                <Text size="xs" c="dimmed">Link</Text>
                <Anchor href="#brand-scale-title" c="pliego">Browse the color scale</Anchor>
              </div>
            </div>
          </div>
        </section>

        <section className={classes.section} aria-labelledby="surface-title">
          <SectionHeading
            id="surface-title"
            eyebrow="06 / Surfaces"
            title="Representative neutral surfaces"
            detail="Surface examples use Mantine’s native semantic and primary variables."
          />
          <div className={classes.surfaceGrid}>
            <SurfaceTile title="Page background" token="--pliego-background" borderToken="--pliego-border" mode="page" />
            <SurfaceTile title="Standard surface" token="--pliego-surface" borderToken="--pliego-border" />
            <SurfaceTile title="Hover surface" token="--pliego-surface-hover" borderToken="--pliego-border" />
            <SurfaceTile
              title="Decorative border"
              token="--pliego-surface"
              borderToken="--pliego-border"
              inspectedToken="--pliego-border"
            />
            <SurfaceTile
              title="Control border"
              token="--pliego-surface"
              borderToken="--pliego-control-border"
              inspectedToken="--pliego-control-border"
            />
            <SurfaceTile title="Disabled surface" token="--mantine-color-disabled" textToken="--mantine-color-disabled-color" />
            <SurfaceTile title="Primary-tinted subtle surface" token="--mantine-primary-color-light" textToken="--mantine-primary-color-light-color" />
          </div>
        </section>

        <section className={classes.section} aria-labelledby="typography-title">
          <SectionHeading
            id="typography-title"
            eyebrow="07 / Typography"
            title="PLIEGO typography"
            detail="Roboto Flex Variable is evaluated through Mantine’s font, heading, size, line-height, and weight tokens."
          />

          <div className={classes.typeSpecimens} data-typography-samples>
            <TypographySpecimen role="Display" metrics="40px / 48px · 600">
              <Text fz="display" lh="display" fw={600} className={classes.pliegoText}>Descubre tu próxima lectura</Text>
            </TypographySpecimen>
            <TypographySpecimen role="H1 / Page title" metrics="32px / 40px · 600">
              <Title order={1} className={classes.pliegoText}>Explorar libros</Title>
            </TypographySpecimen>
            <TypographySpecimen role="H2 / Section title" metrics="28px / 36px · 600">
              <Title order={2} className={classes.pliegoText}>Novedades</Title>
            </TypographySpecimen>
            <TypographySpecimen role="H3" metrics="24px / 32px · 600">
              <Title order={3} className={classes.pliegoText}>Literatura latinoamericana</Title>
            </TypographySpecimen>
            <TypographySpecimen role="Title" metrics="20px / 28px · 600">
              <Text fz="lg" lh="lg" fw={600} className={classes.pliegoText}>Cien años de soledad</Text>
            </TypographySpecimen>
            <TypographySpecimen role="Body large" metrics="16px / 24px · 400">
              <Text fz="md" lh="md" fw={400} className={classes.pliegoText}>
                Explora historias, ideas y conocimiento en un catálogo pensado para lectores.
              </Text>
            </TypographySpecimen>
            <TypographySpecimen role="Body" metrics="14px / 20px · 400">
              <Text fz="sm" lh="sm" fw={400} className={classes.pliegoText}>Gabriel García Márquez</Text>
            </TypographySpecimen>
            <TypographySpecimen role="Label" metrics="14px / 20px · 500">
              <Text fz="sm" lh="sm" fw={500} className={classes.pliegoText}>Agregar al carrito</Text>
            </TypographySpecimen>
            <TypographySpecimen role="Caption / metadata" metrics="12px / 16px · 400">
              <Text fz="xs" lh="xs" fw={400} className={classes.mutedText}>
                Editorial Sudamericana · 432 páginas
              </Text>
            </TypographySpecimen>
          </div>

          <div className={classes.weightSpecimen}>
            <div>
              <Text size="sm" fw={600} className={classes.pliegoText}>Font weights</Text>
              <Text size="xs" lh="xs" className={classes.mutedText}>Smallest role shown above: 12px / 16px, in both color schemes.</Text>
            </div>
            <div className={classes.weightExamples}>
              <WeightSpecimen label="400 · Regular" weight={400} />
              <WeightSpecimen label="500 · Medium" weight={500} />
              <WeightSpecimen label="600 · Semibold" weight={600} />
            </div>
          </div>

          <div className={classes.typeApplicationGrid}>
            <section className={classes.typeApplication} aria-labelledby="book-card-type-title">
              <Text size="xs" lh="xs" fw={500} className={classes.mutedText}>BOOK CARD SPECIMEN</Text>
              <Title order={4} id="book-card-type-title" className={classes.pliegoText}>Cien años de soledad</Title>
              <Text fz="sm" lh="sm" fw={400} className={classes.mutedText}>Gabriel García Márquez</Text>
              <Text fz="xs" lh="xs" fw={400} className={classes.mutedText}>Tapa blanda · Español</Text>
              <div className={classes.typePriceRow}>
                <Text fz="lg" lh="lg" fw={600} className={classes.pliegoText}>$18.50</Text>
                <Text fz="xs" lh="xs" fw={400} className={classes.mutedText}>Disponible</Text>
              </div>
            </section>

            <section className={classes.typeApplication} aria-labelledby="product-detail-type-title">
              <Text size="xs" lh="xs" fw={500} className={classes.mutedText}>PRODUCT DETAIL SPECIMEN</Text>
              <Title order={1} id="product-detail-type-title" className={classes.pliegoText}>Cien años de soledad</Title>
              <Text fz="md" lh="md" fw={400} className={classes.mutedText}>Gabriel García Márquez</Text>
              <Text fz="xs" lh="xs" fw={400} className={classes.mutedText}>Tapa blanda · Español · 432 páginas</Text>
              <Text fz="md" lh="md" fw={400} className={`${classes.productDescription} ${classes.pliegoText}`}>
                Una historia familiar que recorre generaciones y transforma lo cotidiano en extraordinario.
              </Text>
              <div className={classes.typePriceRow}>
                <Text fz="xl" lh="xl" fw={600} className={classes.pliegoText}>$18.50</Text>
                <Button color="pliego">Agregar al carrito</Button>
              </div>
            </section>
          </div>
        </section>

        <section className={classes.section} aria-labelledby="foundations-title">
          <SectionHeading
            id="foundations-title"
            eyebrow="08 / Foundations"
            title="PLIEGO layout foundations"
            detail="Native Mantine spacing, radius, and elevation values shown without PLIEGO overrides."
          />

          <div className={classes.foundationBlock} aria-labelledby="spacing-foundation-title">
            <Title order={3} id="spacing-foundation-title" className={classes.pliegoText}>A. SPACING</Title>
            <Text size="sm" lh="sm" className={classes.mutedText}>
              Mantine spacing tokens measured as rendered horizontal bars.
            </Text>
            <div className={classes.foundationTokenList}>
              {spacingTokens.map((size) => (
                <SpacingTokenTile key={size} size={size} />
              ))}
            </div>

            <div className={classes.foundationSpecimenGrid}>
              <SpacingSpecimen title="Micro icon/text gap" spacing="2xs">
                <Group gap="2xs">
                  <MaterialSymbol name="menu_book" size={16} />
                  <Text size="sm" className={classes.pliegoText}>Browse books</Text>
                </Group>
              </SpacingSpecimen>

              <SpacingSpecimen title="Compact controls" spacing="xs">
                <Group gap="xs">
                  <Button color="pliego" size="xs">Save</Button>
                  <Button variant="default" size="xs">Cancel</Button>
                </Group>
              </SpacingSpecimen>

              <SpacingSpecimen title="BookCard content stack" spacing="sm">
                <Stack gap="sm">
                  <Title order={4} className={classes.pliegoText}>Cien años de soledad</Title>
                  <Text size="sm" className={classes.mutedText}>Gabriel García Márquez</Text>
                  <Text size="xs" className={classes.mutedText}>Rústica · Español</Text>
                  <Text size="md" fw={600} className={classes.pliegoText}>$18.50</Text>
                </Stack>
              </SpacingSpecimen>

              <SpacingSpecimen title="Standard content gap" spacing="md">
                <Stack gap="md">
                  <Title order={3} className={classes.pliegoText}>Novedades</Title>
                  <Text size="md" className={classes.pliegoText}>
                    Explora historias, ideas y conocimiento en un catálogo pensado para lectores.
                  </Text>
                </Stack>
              </SpacingSpecimen>

              <SpacingSpecimen title="Content groups" spacing="lg">
                <Group gap="lg">
                  <Paper p="sm" radius="sm" className={classes.foundationSurface}>Catalog</Paper>
                  <Paper p="sm" radius="sm" className={classes.foundationSurface}>Account</Paper>
                </Group>
              </SpacingSpecimen>

              <SpacingSpecimen title="Large block separation" spacing="xl">
                <Stack gap="xl">
                  <Paper p="sm" radius="sm" className={classes.foundationSurface}>Primary block</Paper>
                  <Paper p="sm" radius="sm" className={classes.foundationSurface}>Related block</Paper>
                </Stack>
              </SpacingSpecimen>

              <SpacingSpecimen title="Page sections" spacing="2xl">
                <Stack gap="2xl">
                  <Paper p="sm" radius="sm" className={classes.foundationSurface}>Catalog section</Paper>
                  <Paper p="sm" radius="sm" className={classes.foundationSurface}>Recommendations section</Paper>
                </Stack>
              </SpacingSpecimen>

              <SpacingSpecimen title="Major page zones" spacing="3xl">
                <Stack gap="3xl">
                  <Paper p="sm" radius="sm" className={classes.foundationSurface}>Main content</Paper>
                  <Paper p="sm" radius="sm" className={classes.foundationSurface}>Supporting content</Paper>
                </Stack>
              </SpacingSpecimen>
            </div>
          </div>

          <div className={classes.foundationBlock} aria-labelledby="shape-foundation-title">
            <Title order={3} id="shape-foundation-title" className={classes.pliegoText}>B. SHAPE</Title>
            <Text size="sm" lh="sm" className={classes.mutedText}>
              Mantine radius tokens are the active PLIEGO shape primitives. Samples use identical dimensions.
            </Text>
            <DefaultRadiusReadout radius={theme.defaultRadius} />
            <div className={classes.foundationTokenGrid}>
              {radiusTokens.map((size) => (
                <RadiusTokenTile key={size} size={size} />
              ))}
            </div>

            <div className={classes.foundationShapeExamples}>
              <div className={classes.foundationShapeExample}>
                <Text size="xs" className={classes.mutedText}>Small input/control · xs</Text>
                <TextInput radius="xs" label="Search" placeholder="Book title" />
              </div>
              <div className={classes.foundationShapeExample}>
                <Text size="xs" className={classes.mutedText}>Button · sm</Text>
                <Button color="pliego" radius="sm">Explore books</Button>
              </div>
              <div className={classes.foundationShapeExample}>
                <Text size="xs" className={classes.mutedText}>BookCard · md</Text>
                <Paper p="sm" radius="md" withBorder className={classes.foundationSurface}>BookCard shell</Paper>
              </div>
              <div className={classes.foundationShapeExample}>
                <Text size="xs" className={classes.mutedText}>Dialog/panel · lg</Text>
                <Paper p="md" radius="lg" withBorder className={classes.foundationSurface}>Dialog panel</Paper>
              </div>
              <div className={classes.foundationShapeExample}>
                <Text size="xs" className={classes.mutedText}>Circular ActionIcon · xl</Text>
                <ActionIcon size={64} radius="xl" variant="default" aria-label="Book action">
                  <MaterialSymbol name="menu_book" size={24} />
                </ActionIcon>
              </div>
            </div>

          </div>

          <div className={classes.foundationBlock} aria-labelledby="elevation-foundation-title">
            <Title order={3} id="elevation-foundation-title" className={classes.pliegoText}>C. ELEVATION</Title>
            <Text size="sm" lh="sm" className={classes.mutedText}>
              Mantine shadow tokens are shown on identical PLIEGO surfaces. The PLIEGO usage policy is listed alongside them.
            </Text>
            <div className={classes.elevationOverview}>
              <div className={classes.foundationShadowGrid}>
                {shadowTokens.map((size) => (
                  <ShadowTokenTile key={size} size={size} />
                ))}
              </div>
              <div className={classes.elevationPolicy}>
                <Text size="sm" fw={600} className={classes.pliegoText}>PLIEGO elevation policy</Text>
                <ElevationPolicyItem title="Static page/surface" value="No shadow" />
                <ElevationPolicyItem title="Static card" value="No shadow; use --pliego-border when separation is needed" />
                <ElevationPolicyItem title="Interactive card" value="Prefer surface/border changes; xs only when interaction needs elevation" />
                <ElevationPolicyItem title="Menu / Popover / floating dropdown" value="sm" />
                <ElevationPolicyItem title="Dialog / Modal" value="md" />
                <ElevationPolicyItem title="lg" value="Exceptional floating surfaces only" />
                <ElevationPolicyItem title="xl" value="Not part of normal PLIEGO UI usage" />
              </div>
            </div>

            <div className={classes.foundationConceptGrid}>
              <ElevationConcept title="Flat surface" detail="No shadow" />
              <ElevationConcept title="Static card" detail="No shadow" />
              <ElevationConcept title="Interactive card" detail="Optional Mantine xs" shadow="xs" />
              <ElevationConcept title="Menu / Popover" detail="Mantine sm" shadow="sm" />
              <ElevationConcept title="Dialog / Modal" detail="Mantine md" shadow="md" />
              <ElevationConcept title="Exceptional floating" detail="Mantine lg · rare" shadow="lg" />
            </div>

            <div className={classes.bookCardShells}>
              <Text size="sm" fw={600} className={classes.pliegoText}>BookCard shell comparison</Text>
              <div className={classes.bookCardShellGrid}>
                <BookCardShell title="Border only" policy="RECOMMENDED DEFAULT" />
                <BookCardShell title="xs" policy="OPTIONAL INTERACTIVE ELEVATION" shadow="xs" />
                <BookCardShell title="md" policy="NOT FOR STATIC BOOK CARDS" shadow="md" />
              </div>
            </div>
          </div>
        </section>
      </div>
        <LayoutSystemSection />
        <CoreComponentsSection />
        <BookCardDiagnostic />
        <StockStatusDiagnostic />
      <div className={`${classes.content} ${classes.footerContent}`}>
        <footer className={classes.footer}>
          <Group gap="xs"><MaterialSymbol name="info" size={16} /><span>Internal design-system inspection route</span></Group>
          <a href="/catalog">Return to catalog</a>
        </footer>
      </div>
    </main>
  );
}

const breakpointEntries = [
  { name: "xs", value: "36em", pixels: 576 },
  { name: "sm", value: "48em", pixels: 768 },
  { name: "md", value: "62em", pixels: 992 },
  { name: "lg", value: "75em", pixels: 1200 },
  { name: "xl", value: "88em", pixels: 1408 },
] as const;

const bookCardSamples = Array.from({ length: 12 }, (_, index) => ({
  title: ["La ciudad y los perros", "Ficciones", "El infinito en un junco"][index % 3],
  author: ["Mario Vargas Llosa", "Jorge Luis Borges", "Irene Vallejo"][index % 3],
}));

interface LayoutMeasurements {
  viewport: number;
  shell1280: number;
  shell1440: number;
  mantineRoot: number;
  mantineContent: number;
  catalogColumns: number;
  catalogCard: number;
  productCover: number;
  productContent: number;
  measure65: number;
  measure70: number;
  measure75: number;
  headerLeft: number;
  mainLeft: number;
  footerLeft: number;
  headerHeight: number;
  overflow: number;
}

const emptyLayoutMeasurements: LayoutMeasurements = {
  viewport: 0,
  shell1280: 0,
  shell1440: 0,
  mantineRoot: 0,
  mantineContent: 0,
  catalogColumns: 0,
  catalogCard: 0,
  productCover: 0,
  productContent: 0,
  measure65: 0,
  measure70: 0,
  measure75: 0,
  headerLeft: 0,
  mainLeft: 0,
  footerLeft: 0,
  headerHeight: 0,
  overflow: 0,
};

function LayoutSystemSection() {
  const shell1280Ref = useRef<HTMLDivElement>(null);
  const shell1440Ref = useRef<HTMLDivElement>(null);
  const mantineRootRef = useRef<HTMLDivElement>(null);
  const mantineContentRef = useRef<HTMLDivElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const productCoverRef = useRef<HTMLDivElement>(null);
  const productContentRef = useRef<HTMLDivElement>(null);
  const measure65Ref = useRef<HTMLParagraphElement>(null);
  const measure70Ref = useRef<HTMLParagraphElement>(null);
  const measure75Ref = useRef<HTMLParagraphElement>(null);
  const shellHeaderRef = useRef<HTMLDivElement>(null);
  const shellMainRef = useRef<HTMLDivElement>(null);
  const shellFooterRef = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState(emptyLayoutMeasurements);

  useEffect(() => {
    const measure = () => {
      const viewport = document.documentElement.clientWidth;
      const catalogStyle = catalogRef.current ? getComputedStyle(catalogRef.current) : null;
      const catalogColumns = catalogStyle?.gridTemplateColumns
        .split(" ")
        .filter((value) => value && value !== "none").length ?? 0;
      const catalogCard = catalogRef.current?.firstElementChild?.getBoundingClientRect().width ?? 0;
      const headerRect = shellHeaderRef.current?.parentElement?.getBoundingClientRect();

      setMeasurements({
        viewport,
        shell1280: shell1280Ref.current?.getBoundingClientRect().width ?? 0,
        shell1440: shell1440Ref.current?.getBoundingClientRect().width ?? 0,
        mantineRoot: mantineRootRef.current?.getBoundingClientRect().width ?? 0,
        mantineContent: mantineContentRef.current?.getBoundingClientRect().width ?? 0,
        catalogColumns,
        catalogCard,
        productCover: productCoverRef.current?.getBoundingClientRect().width ?? 0,
        productContent: productContentRef.current?.getBoundingClientRect().width ?? 0,
        measure65: measure65Ref.current?.getBoundingClientRect().width ?? 0,
        measure70: measure70Ref.current?.getBoundingClientRect().width ?? 0,
        measure75: measure75Ref.current?.getBoundingClientRect().width ?? 0,
        headerLeft: shellHeaderRef.current?.getBoundingClientRect().left ?? 0,
        mainLeft: shellMainRef.current?.getBoundingClientRect().left ?? 0,
        footerLeft: shellFooterRef.current?.getBoundingClientRect().left ?? 0,
        headerHeight: headerRect?.height ?? 0,
        overflow: Math.max(0, document.documentElement.scrollWidth - viewport),
      });
    };

    const observer = new ResizeObserver(measure);
    const elements = [
      shell1280Ref.current,
      shell1440Ref.current,
      mantineRootRef.current,
      mantineContentRef.current,
      catalogRef.current,
      productCoverRef.current,
      productContentRef.current,
      measure65Ref.current,
      measure70Ref.current,
      measure75Ref.current,
      shellHeaderRef.current,
      shellMainRef.current,
      shellFooterRef.current,
    ].filter((element): element is HTMLDivElement | HTMLParagraphElement => element !== null);

    elements.forEach((element) => observer.observe(element));
    window.addEventListener("resize", measure);
    const frame = requestAnimationFrame(measure);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  const activeBreakpoint = getActiveBreakpoint(measurements.viewport);
  const gutter1280 = (measurements.viewport - measurements.shell1280) / 2;
  const gutter1440 = (measurements.viewport - measurements.shell1440) / 2;

  return (
    <section className={`${classes.section} ${classes.layoutSection}`} aria-labelledby="layout-system-title" data-layout-diagnostic>
      <SectionHeading
        id="layout-system-title"
        eyebrow="09 / Layout"
        title="PLIEGO responsive layout system"
        detail="Rendered geometry for shell, grid, catalog, product-detail, reading-measure, and page-shell decisions."
      />

      <div className={classes.layoutStatusBar}>
        <Measurement label="Viewport" value={`${formatPixels(measurements.viewport)}px`} />
        <Measurement label="Active range" value={activeBreakpoint.label} />
        <Measurement label="Horizontal overflow" value={`${formatPixels(measurements.overflow)}px`} />
      </div>

      <div className={classes.layoutBlock}>
        <LayoutBlockHeading title="A. BREAKPOINTS" detail="Mantine defaults are active; PLIEGO does not override theme.breakpoints." />
        <div className={classes.breakpointGrid}>
          <div className={`${classes.breakpointCard} ${activeBreakpoint.name === "base" ? classes.activeBreakpoint : ""}`}>
            <Text fw={600}>base</Text>
            <code>&lt; 36em</code>
            <Text size="xs" className={classes.mutedText}>0–575px</Text>
          </div>
          {breakpointEntries.map((breakpoint) => (
            <div
              key={breakpoint.name}
              className={`${classes.breakpointCard} ${activeBreakpoint.name === breakpoint.name ? classes.activeBreakpoint : ""}`}
            >
              <Text fw={600}>{breakpoint.name}</Text>
              <code>{breakpoint.value}</code>
              <Text size="xs" className={classes.mutedText}>{breakpoint.pixels}px</Text>
            </div>
          ))}
        </div>
      </div>

      <div className={classes.layoutBlock}>
        <LayoutBlockHeading
          title="B. CONTENT SHELL"
          detail="Both candidates use 16px base, 24px from sm, and 32px from lg. The displayed gutter is the rendered distance from viewport edge to content."
        />
        <div className={classes.shellComparison}>
          <div className={classes.candidateBand}>
            <div ref={shell1280Ref} className={`${classes.layoutShell} ${classes.shell1280}`} data-layout-shell="1280">
              <MeasurementRow
                title="1280px candidate"
                values={[
                  ["viewport", `${formatPixels(measurements.viewport)}px`],
                  ["gutter", `${formatPixels(gutter1280)}px`],
                  ["content", `${formatPixels(measurements.shell1280)}px`],
                ]}
              />
            </div>
          </div>
          <div className={classes.candidateBand}>
            <div ref={shell1440Ref} className={`${classes.layoutShell} ${classes.shell1440}`} data-layout-shell="1440">
              <MeasurementRow
                title="1440px candidate"
                values={[
                  ["viewport", `${formatPixels(measurements.viewport)}px`],
                  ["gutter", `${formatPixels(gutter1440)}px`],
                  ["content", `${formatPixels(measurements.shell1440)}px`],
                ]}
              />
            </div>
          </div>
        </div>

        <div className={`${classes.layoutShell} ${classes.shell1440} ${classes.containerComparison}`}>
          <div className={classes.containerSpecimenFrame}>
            <Container ref={mantineRootRef} size={1440} className={classes.mantineContainerSpecimen}>
              <div ref={mantineContentRef} className={classes.containerInnerMeasure}>
                <Text size="sm" fw={600}>Mantine Container · block strategy</Text>
                <Text size="xs" className={classes.mutedText}>
                  Root {formatPixels(measurements.mantineRoot)}px · inner {formatPixels(measurements.mantineContent)}px · native inline padding 16px
                </Text>
              </div>
            </Container>
          </div>
          <div className={classes.apiAssessment}>
            <Text size="sm" fw={600}>Verified Container behavior</Text>
            <Text size="xs" className={classes.mutedText}>
              size is a fixed max-width, fluid ignores it, and grid strategy enables data-breakout/data-container while removing default padding.
            </Text>
          </div>
        </div>
      </div>

      <div className={classes.layoutBlock}>
        <LayoutBlockHeading title="C. FULL-WIDTH SECTIONS" detail="The background spans the available page width while each inner region returns to the same 1440px shell." />
        <div className={classes.fullWidthDemo} data-full-width-section="constrained">
          <div className={`${classes.layoutShell} ${classes.shell1440}`}>
            <Text size="xs" fw={600}>CONSTRAINED CONTENT · aligned shell</Text>
          </div>
        </div>
        <div className={`${classes.fullWidthDemo} ${classes.fullWidthAccent}`} data-full-width-section="accent">
          <div className={`${classes.layoutShell} ${classes.shell1440}`}>
            <Text size="xs" fw={600}>FULL-WIDTH BACKGROUND · content realigned to shell</Text>
          </div>
        </div>
      </div>

      <div className={classes.layoutBlock}>
        <LayoutBlockHeading title="D. STRUCTURAL GRID" detail="Mantine Grid rendered as its native responsive 12-column flex grid with the approved 16px gap." />
        <div className={`${classes.layoutShell} ${classes.shell1440} ${classes.structuralGridExamples}`}>
          <StructuralGrid label="12" spans={[12]} />
          <StructuralGrid label="6 + 6" spans={[6, 6]} />
          <StructuralGrid label="4 + 8" spans={[4, 8]} />
          <StructuralGrid label="3 + 6 + 3" spans={[3, 6, 3]} />
        </div>
      </div>

      <div className={classes.layoutBlock}>
        <LayoutBlockHeading
          title="E. CATALOG GRID"
          detail="CSS-native progression: base 2, sm 3, md 4, lg 5, xl 6. Neutral shells isolate geometry from production card styling."
        />
        <div className={`${classes.layoutShell} ${classes.shell1440}`}>
          <div className={classes.inlineMetrics}>
            <Measurement label="Columns" value={String(measurements.catalogColumns)} />
            <Measurement label="Card width" value={`${formatPixels(measurements.catalogCard)}px`} />
            <Measurement label="Grid gap" value="16px" />
          </div>
          <div ref={catalogRef} className={classes.catalogLayoutGrid} data-catalog-grid>
            {bookCardSamples.map((book, index) => (
              <article className={classes.neutralBookCard} key={`${book.title}-${index}`}>
                <div className={classes.neutralCover} aria-hidden="true" />
                <Text size="sm" fw={600} lineClamp={2}>{book.title}</Text>
                <Text size="xs" className={classes.mutedText} lineClamp={2}>{book.author}</Text>
                <Text size="sm" fw={600}>$18.50</Text>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className={classes.layoutBlock}>
        <LayoutBlockHeading
          title="F. PRODUCT DETAIL"
          detail="base uses one column; md uses 5/12 + 7/12; lg and above use 4/12 + 8/12. Mantine responsive Grid props generate the media-query behavior."
        />
        <div className={`${classes.layoutShell} ${classes.shell1440}`}>
          <div className={classes.inlineMetrics}>
            <Measurement label="Cover column" value={`${formatPixels(measurements.productCover)}px`} />
            <Measurement label="Content column" value={`${formatPixels(measurements.productContent)}px`} />
            <Measurement label="Pattern" value={getProductPattern(measurements.viewport)} />
          </div>
          <Grid gap={{ base: "md", lg: "lg" }} className={classes.productGrid} data-product-grid>
            <Grid.Col span={{ base: 12, md: 5, lg: 4 }}>
              <div ref={productCoverRef} className={classes.productCoverShell} data-product-region="cover">
                <div className={classes.productCover} aria-hidden="true" />
                <Text size="xs" className={classes.mutedText}>Neutral 2:3 cover shell</Text>
              </div>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7, lg: 8 }}>
              <div ref={productContentRef} className={classes.productCopy} data-product-region="content">
                <Text size="xs" fw={500} className={classes.mutedText}>PRODUCT DETAIL</Text>
                <Title order={3}>El infinito en un junco</Title>
                <Text size="md" className={classes.mutedText}>Irene Vallejo</Text>
                <Text size="xl" fw={600}>$22.90</Text>
                <Text size="md">
                  Una exploración de la historia de los libros, de quienes los protegieron y de la manera en que la lectura acompaña la memoria colectiva.
                </Text>
              </div>
            </Grid.Col>
          </Grid>
        </div>

        <div className={`${classes.layoutShell} ${classes.shell1440} ${classes.readingMeasures}`}>
          <ReadingMeasure label="65ch" width="65ch" measured={measurements.measure65} paragraphRef={measure65Ref} />
          <ReadingMeasure label="70ch" width="70ch" measured={measurements.measure70} paragraphRef={measure70Ref} />
          <ReadingMeasure label="75ch" width="75ch" measured={measurements.measure75} paragraphRef={measure75Ref} />
        </div>
      </div>

      <div className={classes.layoutBlock}>
        <LayoutBlockHeading
          title="G. PAGE SHELL"
          detail="Semantic header, main, and footer share one shell. Header height is 56px on mobile and 64px from sm upward."
        />
        <article className={classes.pageShellDemo} data-page-shell>
          <header className={classes.demoHeader}>
            <div ref={shellHeaderRef} className={`${classes.layoutShell} ${classes.shell1440} ${classes.shellAlignedContent}`}>
              <Text fw={600}>Header</Text><Text size="xs">{formatPixels(measurements.headerHeight)}px</Text>
            </div>
          </header>
          <div className={classes.demoMain} data-semantic-element="main">
            <div ref={shellMainRef} className={`${classes.layoutShell} ${classes.shell1440} ${classes.shellAlignedContent}`}>
              <Text fw={600}>Main</Text><Text size="xs">Shared content start</Text>
            </div>
          </div>
          <footer className={classes.demoFooter}>
            <div ref={shellFooterRef} className={`${classes.layoutShell} ${classes.shell1440} ${classes.shellAlignedContent}`}>
              <Text fw={600}>Footer</Text><Text size="xs">Shared content start</Text>
            </div>
          </footer>
        </article>
        <div className={`${classes.layoutShell} ${classes.shell1440} ${classes.inlineMetrics}`}>
          <Measurement label="Header x" value={`${formatPixels(measurements.headerLeft)}px`} />
          <Measurement label="Main x" value={`${formatPixels(measurements.mainLeft)}px`} />
          <Measurement label="Footer x" value={`${formatPixels(measurements.footerLeft)}px`} />
        </div>
        <div className={`${classes.layoutShell} ${classes.shell1440} ${classes.apiAssessment}`}>
          <Text size="sm" fw={600}>Verified AppShell behavior</Text>
          <Text size="xs" className={classes.mutedText}>
            AppShell coordinates fixed header, footer, navbar, and aside regions plus their offsets. This storefront shell has no persistent side regions and does not need fixed page chrome.
          </Text>
        </div>
      </div>
    </section>
  );
}

function LayoutBlockHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={`${classes.layoutShell} ${classes.shell1440} ${classes.layoutBlockHeading}`}>
      <Title order={3}>{title}</Title>
      <Text size="sm" className={classes.mutedText}>{detail}</Text>
    </div>
  );
}

function Measurement({ label, value }: { label: string; value: string }) {
  return <span className={classes.measurement}><span>{label}</span><strong>{value}</strong></span>;
}

function MeasurementRow({ title, values }: { title: string; values: [string, string][] }) {
  return (
    <div className={classes.measurementRow}>
      <Text size="sm" fw={600}>{title}</Text>
      <div className={classes.measurementValues}>
        {values.map(([label, value]) => <Measurement key={label} label={label} value={value} />)}
      </div>
    </div>
  );
}

function StructuralGrid({ label, spans }: { label: string; spans: number[] }) {
  return (
    <div className={classes.structuralGridRow}>
      <Text size="xs" fw={600}>{label}</Text>
      <Grid gap="md">
        {spans.map((span, index) => (
          <Grid.Col span={span} key={`${label}-${index}`}>
            <div className={classes.structuralGridCell}>{span}/12</div>
          </Grid.Col>
        ))}
      </Grid>
    </div>
  );
}

function ReadingMeasure({
  label,
  width,
  measured,
  paragraphRef,
}: {
  label: string;
  width: string;
  measured: number;
  paragraphRef: RefObject<HTMLParagraphElement | null>;
}) {
  return (
    <div className={classes.readingMeasure}>
      <Measurement label={label} value={`${formatPixels(measured)}px`} />
      <p ref={paragraphRef} style={{ maxWidth: width }} data-reading-measure={label}>
        Los libros viajan a través del tiempo porque cada generación encuentra una forma distinta de leerlos, conservarlos y compartir sus ideas.
      </p>
    </div>
  );
}

function getActiveBreakpoint(viewport: number) {
  const active = [...breakpointEntries].reverse().find((breakpoint) => viewport >= breakpoint.pixels);
  if (!active) return { name: "base", label: "base · < 576px" };
  const next = breakpointEntries.find((breakpoint) => breakpoint.pixels > active.pixels);
  return {
    name: active.name,
    label: next ? `${active.name} · ${active.pixels}–${next.pixels - 1}px` : `${active.name} · ≥ ${active.pixels}px`,
  };
}

function getProductPattern(viewport: number) {
  if (viewport >= 1200) return "4/12 + 8/12";
  if (viewport >= 992) return "5/12 + 7/12";
  return "1 column";
}

function formatPixels(value: number) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

const formatOptions = [
  { value: "paperback", label: "Tapa blanda" },
  { value: "hardcover", label: "Tapa dura" },
  { value: "ebook", label: "Libro electrónico" },
];

const ownershipRows = [
  { primitive: "Button", decision: "B", contract: "Mantine Button with PLIEGO color, radius, focus, and standard size defaults." },
  { primitive: "ButtonLink", decision: "C", contract: "Guarantees navigation uses React Router link semantics while sharing approved action variants." },
  { primitive: "ActionIcon", decision: "B", contract: "Mantine directly; PLIEGO sets target size and requires an accessible name." },
  { primitive: "Text / Password / Number input", decision: "B", contract: "Mantine inputs with shared size, control border, error, and focus defaults." },
  { primitive: "Select", decision: "B", contract: "Mantine Select for one value from a fixed, primitive option set." },
  { primitive: "Rich domain picker", decision: "C", contract: "A focused domain component may own search, rich option rendering, and value translation over Combobox primitives." },
  { primitive: "Chip", decision: "B", contract: "Mantine Chip for a user-selectable filter value; checked state remains semantic." },
  { primitive: "Pill", decision: "A", contract: "Use directly for a removable value when the caller supplies a specific remove label." },
  { primitive: "Badge", decision: "B", contract: "Theme defaults plus visible text/icon semantics for information or promotion." },
  { primitive: "StockStatus", decision: "C", contract: "Maps availability to approved Spanish text, symbol, tone, and accessibility consistently." },
  { primitive: "BookCard", decision: "C", contract: "Future product component owns edition navigation, cover, metadata, actions, and state semantics." },
] as const;

function CoreComponentsSection() {
  const [selectedFilter, setSelectedFilter] = useState(true);
  const [showRemovableFilter, setShowRemovableFilter] = useState(true);

  return (
    <section className={`${classes.section} ${classes.coreSection}`} aria-labelledby="core-components-title" data-core-components>
      <div className={`${classes.layoutShell} ${classes.shell1440}`}>
        <SectionHeading
          id="core-components-title"
          eyebrow="10 / Core components"
          title="PLIEGO interactive primitives"
          detail="Representative Mantine controls, semantic states, and ownership boundaries before production-page redesign."
        />

        <CoreGroup
          title="A. BUTTONS"
          detail="Native Mantine variants using the approved PLIEGO theme. The production default is md with an effective 44px control height."
        >
          <div className={classes.coreSpecimenGrid}>
            <CoreSpecimen label="Primary · filled"><Button data-focus-start data-core-button-standard color="pliego">Explorar catálogo</Button></CoreSpecimen>
            <CoreSpecimen label="Secondary · light"><Button data-focus-target color="pliego" variant="light">Guardar para después</Button></CoreSpecimen>
            <CoreSpecimen label="Outline"><Button color="pliego" variant="outline">Ver detalles</Button></CoreSpecimen>
            <CoreSpecimen label="Text-like · subtle"><Button color="pliego" variant="subtle">Limpiar filtros</Button></CoreSpecimen>
            <CoreSpecimen label="Destructive"><Button color="red">Eliminar dirección</Button></CoreSpecimen>
            <CoreSpecimen label="Disabled"><Button color="pliego" disabled>Continuar</Button></CoreSpecimen>
            <CoreSpecimen label="Loading"><Button color="pliego" loading>Cargando</Button></CoreSpecimen>
            <CoreSpecimen label="Symbol before label">
              <Button color="pliego" leftSection={<MaterialSymbol name="shopping_cart" size={18} aria-hidden="true" />}>Agregar al carrito</Button>
            </CoreSpecimen>
            <CoreSpecimen label="Symbol after label">
              <Button color="pliego" rightSection={<MaterialSymbol name="arrow_forward" size={18} aria-hidden="true" />}>Continuar</Button>
            </CoreSpecimen>
          </div>
          <div className={classes.sizeComparison}>
            <CoreSpecimen label="Theme default · 44px"><Button data-core-button-size="default" color="pliego">Acción normal</Button></CoreSpecimen>
            <CoreSpecimen label="Intentional lg · 50px"><Button data-core-button-size="lg" color="pliego" size="lg">Acción normal</Button></CoreSpecimen>
          </div>
        </CoreGroup>

        <CoreGroup
          title="B. ACTION ICON"
          detail="Icon-only controls keep Mantine semantics. The theme default xl supplies a native 44px target, every caller supplies an accessible name, and circular shape requires an explicit radius."
        >
          <div className={classes.actionIconGrid}>
            <CoreSpecimen label="Default"><ActionIcon data-core-action-icon variant="default" aria-label="Ver ficha"><MaterialSymbol name="menu_book" aria-hidden="true" /></ActionIcon></CoreSpecimen>
            <CoreSpecimen label="Subtle"><ActionIcon color="pliego" variant="subtle" aria-label="Editar"><MaterialSymbol name="edit" aria-hidden="true" /></ActionIcon></CoreSpecimen>
            <CoreSpecimen label="Outline"><ActionIcon color="pliego" variant="outline" aria-label="Copiar enlace"><MaterialSymbol name="content_copy" aria-hidden="true" /></ActionIcon></CoreSpecimen>
            <CoreSpecimen label="Filled"><ActionIcon color="pliego" variant="filled" aria-label="Agregar a favoritos"><MaterialSymbol name="favorite" aria-hidden="true" /></ActionIcon></CoreSpecimen>
            <CoreSpecimen label="Disabled"><ActionIcon color="pliego" variant="filled" aria-label="Acción no disponible" disabled><MaterialSymbol name="block" aria-hidden="true" /></ActionIcon></CoreSpecimen>
            <CoreSpecimen label="Circular · explicit radius"><ActionIcon radius="xl" color="pliego" variant="light" aria-label="Abrir búsqueda"><MaterialSymbol name="search" aria-hidden="true" /></ActionIcon></CoreSpecimen>
          </div>
        </CoreGroup>

        <CoreGroup
          title="C. TEXT INPUTS"
          detail="Mantine input wrappers provide label, description, error, disabled, and section APIs. PLIEGO supplies control-border and focus defaults through Styles API or theme configuration."
        >
          <div className={classes.inputGrid}>
            <TextInput data-core-input="text" label="Nombre" placeholder="Escribe tu nombre" description="Tal como aparece en tu identificación." />
            <TextInput label="Correo electrónico" defaultValue="lectora@ejemplo.com" />
            <TextInput label="Campo deshabilitado" defaultValue="No editable" disabled />
            <TextInput label="Correo electrónico" defaultValue="correo-incompleto" error="Ingresa un correo electrónico válido." />
            <TextInput classNames={{ input: classes.forcedHoverInput }} label="Estado hover" placeholder="Pasa el puntero" />
            <TextInput data-core-input="focus" label="Focus-visible real" defaultValue="Usa Tab para verificar" />
            <PasswordInput
              attributes={{ input: { "data-core-input": "password" } }}
              label="Contraseña"
              defaultValue="lectura-segura"
              description="Usa al menos 12 caracteres."
              visibilityToggleButtonProps={{ "aria-label": "Mostrar u ocultar contraseña" }}
            />
            <NumberInput data-core-input="number" label="Cantidad" defaultValue={1} min={1} max={20} clampBehavior="strict" />
            <TextInput
              type="search"
              label="Buscar en el catálogo"
              placeholder="Título, autor o ISBN"
              leftSection={<MaterialSymbol name="search" size={18} aria-hidden="true" />}
            />
          </div>
          <div className={classes.sizeComparison}>
            <TextInput data-core-input-size="default" label="Theme default · 44px" placeholder="Entrada normal" />
            <TextInput data-core-input-size="lg" size="lg" label="Intentional lg · 50px" placeholder="Entrada normal" />
          </div>
        </CoreGroup>

        <CoreGroup
          title="D. SELECT / COMBOBOX"
          detail="Select owns fixed single-choice fields. Combobox primitives remain reserved for domain controls with search, rich rendering, or nontrivial value mapping."
        >
          <div className={classes.selectComparison}>
            <Select
              data-core-input="select"
              label="Formato"
              description="Una opción de un conjunto fijo."
              placeholder="Elige un formato"
              data={formatOptions}
              defaultValue="paperback"
              allowDeselect={false}
            />
            <Paper withBorder p="md" radius="md" className={classes.coreAssessmentCard}>
              <Text size="sm" fw={600}>Combobox threshold</Text>
              <Text size="sm" className={classes.mutedText}>
                Use a focused domain component only when options need search, flags or metadata, custom filtering, or object-to-value translation. Do not add a generic PLIEGO combobox wrapper.
              </Text>
            </Paper>
          </div>
        </CoreGroup>

        <CoreGroup
          title="E. FILTERS / CHIPS / STATUS"
          detail="Chip is a selectable filter, Pill is an applied/removable value, and Badge is noninteractive information or promotion. Status always pairs color with visible text and a symbol."
        >
          <div className={classes.semanticCompactGrid}>
            <CoreSpecimen label="Selectable filter · Chip">
              <Chip color="pliego" checked={selectedFilter} onChange={setSelectedFilter}>En español</Chip>
            </CoreSpecimen>
            <CoreSpecimen label="Applied filter · removable Pill">
              {showRemovableFilter
                ? <Pill
                    size="md"
                    withRemoveButton
                    onRemove={() => setShowRemovableFilter(false)}
                    removeButtonProps={{ "aria-label": "Quitar filtro Idioma: Español" }}
                  >Idioma: Español</Pill>
                : <Button size="compact-sm" variant="subtle" color="pliego" onClick={() => setShowRemovableFilter(true)}>Restaurar filtro</Button>}
            </CoreSpecimen>
            <CoreSpecimen label="Information · Badge">
              <Badge color="gray" variant="light" leftSection={<MaterialSymbol name="info" size={14} aria-hidden="true" />}>Edición impresa</Badge>
            </CoreSpecimen>
            <CoreSpecimen label="Stock · text + symbol">
              <Badge color="pliego" variant="light" leftSection={<MaterialSymbol name="check_circle" size={14} aria-hidden="true" />}>Disponible</Badge>
            </CoreSpecimen>
            <CoreSpecimen label="Unavailable · text + symbol">
              <Badge color="red" variant="light" leftSection={<MaterialSymbol name="block" size={14} aria-hidden="true" />}>Agotado</Badge>
            </CoreSpecimen>
            <CoreSpecimen label="Promotion · Badge">
              <Badge color="pliego" variant="outline" leftSection={<MaterialSymbol name="inventory_2" size={14} aria-hidden="true" />}>Novedad</Badge>
            </CoreSpecimen>
          </div>
        </CoreGroup>

        <CoreGroup
          title="F. INTERACTIVE SURFACES"
          detail="The shell stays flat by default. Hover may add xs elevation when it communicates interactivity; focus and selected states remain explicit."
        >
          <div className={classes.surfaceStateGrid}>
            <article className={classes.coreBookSurface}>
              <NeutralBookSurfaceContent state="Static" />
            </article>
            <button type="button" className={`${classes.coreBookSurface} ${classes.surfaceHover}`} aria-label="Abrir La ciudad y los perros">
              <NeutralBookSurfaceContent state="Hover" />
            </button>
            <button type="button" className={`${classes.coreBookSurface} ${classes.surfaceFocus}`} aria-label="Abrir La ciudad y los perros, enfoque visible">
              <NeutralBookSurfaceContent state="Focus-visible" />
            </button>
            <button type="button" className={`${classes.coreBookSurface} ${classes.surfaceSelected}`} aria-label="La ciudad y los perros seleccionado" aria-pressed="true">
              <NeutralBookSurfaceContent state="Selected choice" />
            </button>
          </div>
          <Text size="xs" className={classes.mutedText}>Selected is reserved for explicit selection workflows; catalog navigation cards do not imply selection.</Text>
        </CoreGroup>

        <CoreGroup
          title="G. INTERACTION STATE MATRIX"
          detail="A compact comparison of representative control states. The focus specimen uses the same tokenized ring verified with keyboard input."
        >
          <div className={classes.stateMatrix}>
            <CoreSpecimen label="Default"><Button color="pliego">Acción</Button></CoreSpecimen>
            <CoreSpecimen label="Hover"><Button color="pliego" className={classes.forcedHoverButton}>Acción</Button></CoreSpecimen>
            <CoreSpecimen label="Focus-visible · use Tab"><Button color="pliego" data-focus-target>Acción</Button></CoreSpecimen>
            <CoreSpecimen label="Active / pressed"><Button color="pliego" className={classes.forcedActiveButton}>Acción</Button></CoreSpecimen>
            <CoreSpecimen label="Disabled"><Button color="pliego" disabled>Acción</Button></CoreSpecimen>
          </div>
        </CoreGroup>

        <CoreGroup
          title="H. COMPONENT OWNERSHIP"
          detail="A uses Mantine directly, B uses Mantine with PLIEGO theme/defaults, and C is justified only by a repeated product contract."
        >
          <div className={classes.ownershipMatrix} role="list">
            {ownershipRows.map((row) => (
              <div className={classes.ownershipRow} role="listitem" key={row.primitive}>
                <Badge color={row.decision === "C" ? "pliego" : "gray"} variant={row.decision === "A" ? "outline" : "light"}>{row.decision}</Badge>
                <Text size="sm" fw={600}>{row.primitive}</Text>
                <Text size="sm" className={classes.mutedText}>{row.contract}</Text>
              </div>
            ))}
          </div>
        </CoreGroup>
      </div>
    </section>
  );
}

function CoreGroup({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className={classes.coreGroup}>
      <div className={classes.coreGroupHeading}>
        <Title order={3}>{title}</Title>
        <Text size="sm" className={classes.mutedText}>{detail}</Text>
      </div>
      {children}
    </div>
  );
}

function CoreSpecimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={classes.coreSpecimen}>
      <Text size="xs" fw={500} className={classes.mutedText}>{label}</Text>
      <div className={classes.coreSpecimenStage}>{children}</div>
    </div>
  );
}

function NeutralBookSurfaceContent({ state }: { state: string }) {
  return (
    <>
      <span className={classes.coreBookCover} aria-hidden="true" />
      <span className={classes.coreBookCopy}>
        <Text component="span" size="sm" fw={600}>La ciudad y los perros</Text>
        <Text component="span" size="xs" className={classes.mutedText}>Mario Vargas Llosa</Text>
        <Text component="span" size="xs" fw={600}>{state}</Text>
      </span>
    </>
  );
}

function SectionHeading({ id, eyebrow, title, detail }: { id: string; eyebrow: string; title: string; detail?: string }) {
  return (
    <div className={classes.sectionHeading}>
      <Text className={classes.eyebrow} size="xs" lh="xs" fw={500}>{eyebrow}</Text>
      <Title order={2} id={id} className={classes.pliegoText}>{title}</Title>
      {detail && <Text size="sm" lh="sm" className={classes.mutedText}>{detail}</Text>}
    </div>
  );
}

function TypographySpecimen({ role, metrics, children }: { role: string; metrics: string; children: ReactNode }) {
  return (
    <div className={classes.typeSpecimen} data-typography-role={role}>
      <div className={classes.typeSpecimenMeta}>
        <Text size="xs" lh="xs" fw={500} className={classes.pliegoText}>{role}</Text>
        <Text size="xs" lh="xs" fw={400} className={classes.mutedText}>{metrics}</Text>
      </div>
      <div className={classes.typeSpecimenSample} data-typography-sample>{children}</div>
    </div>
  );
}

function WeightSpecimen({ label, weight }: { label: string; weight: 400 | 500 | 600 }) {
  return (
    <div className={classes.weightSpecimenItem} data-typography-weight={label}>
      <Text size="xs" lh="xs" fw={500} className={classes.mutedText}>{label}</Text>
      <Text fz="md" lh="md" fw={weight} data-weight-sample className={classes.pliegoText}>
        Roboto Flex: lectura cómoda, clara y cercana.
      </Text>
    </div>
  );
}

function ColorTile({ index, name, value, color }: { index: number; name: string; value: string; color: string }) {
  return (
    <div className={classes.colorTile}>
      <div className={classes.colorSwatch} style={{ backgroundColor: color }} aria-label={`${name}: ${value}`} />
      <div className={classes.colorMeta}>
        <span className={classes.colorIndex}>{index}</span>
        <code>{name}</code>
        <code>{value}</code>
      </div>
    </div>
  );
}

function VariableTile({ token, label, kind }: { token: string; label: string; kind: "surface" | "text" | "border" }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [resolvedValue, setResolvedValue] = useState("");
  const computedColorScheme = useComputedColorScheme("light");
  const previewProperty = kind === "text" ? "color" : kind === "border" ? "border-top-color" : "background-color";

  useEffect(() => {
    if (!previewRef.current) return;
    setResolvedValue(getComputedStyle(previewRef.current).getPropertyValue(previewProperty).trim());
  }, [computedColorScheme, previewProperty, token]);

  return (
    <div className={classes.variableTile}>
      <div className={`${classes.variablePreview} ${kind === "text" ? classes.variablePreviewText : ""} ${kind === "border" ? classes.variablePreviewBorder : ""}`}>
        <div
          ref={previewRef}
          className={`${classes.variableSample} ${kind === "surface" ? classes.variableFillSample : ""}`}
          style={kind === "text" ? { color: `var(${token})` } : kind === "border" ? { borderTopColor: `var(${token})` } : { backgroundColor: `var(${token})` }}
        >
          {kind === "text" ? "Aa" : kind === "border" ? <span>Border</span> : " "}
        </div>
      </div>
      <div className={classes.variableMeta}>
        <span>{label}</span>
        <code>{token}</code>
        <code className={classes.resolvedValue}>{resolvedValue || "…"}</code>
      </div>
    </div>
  );
}

function RoleTile({ role, lightSurface, darkSurface }: {
  role: ReturnType<typeof getPliegoSemanticRoles>[number];
  lightSurface: string;
  darkSurface: string;
}) {
  return (
    <div className={classes.roleTile}>
      <div className={classes.roleHeading}>
        <span>{role.label}</span>
        <code>{role.token}</code>
      </div>
      <div className={classes.roleSchemes}>
        <RoleSchemeSample label="Light" value={role.light} kind={role.kind} surface={lightSurface} />
        <RoleSchemeSample label="Dark" value={role.dark} kind={role.kind} surface={darkSurface} />
      </div>
    </div>
  );
}

function RoleSchemeSample({ label, value, kind, surface }: {
  label: string;
  value: string;
  kind: "surface" | "text" | "border";
  surface: string;
}) {
  return (
    <div className={classes.roleSchemeSample}>
      <span className={classes.roleSchemeLabel}>{label}</span>
      <div
        className={`${classes.roleColorSample} ${kind === "border" ? classes.roleBorderSample : ""}`}
        style={{
          backgroundColor: kind === "surface" ? value : surface,
          color: kind === "text" ? value : undefined,
          borderTopColor: kind === "border" ? value : undefined,
        }}
      >
        {kind === "text" ? "Aa" : kind === "border" ? "Border" : null}
      </div>
      <code>{value}</code>
    </div>
  );
}

function SurfaceTile({ title, token, borderToken, textToken, inspectedToken = token, mode }: {
  title: string;
  token: string;
  borderToken?: string;
  textToken?: string;
  inspectedToken?: string;
  mode?: "page";
}) {
  const computedColorScheme = useComputedColorScheme("light");
  const [resolvedValue, setResolvedValue] = useState("");

  useEffect(() => {
    setResolvedValue(getComputedStyle(document.documentElement).getPropertyValue(inspectedToken).trim());
  }, [computedColorScheme, inspectedToken]);

  return (
    <div
      className={`${classes.surfaceTile} ${mode === "page" ? classes.pageSurface : ""}`}
      style={{
        backgroundColor: `var(${token})`,
        color: `var(${textToken ?? "--pliego-text"})`,
        borderColor: `var(${borderToken ?? "--pliego-border"})`,
      }}
    >
      <span>{title}</span>
      <code>{inspectedToken}</code>
      <code className={classes.resolvedValue}>{resolvedValue || "…"}</code>
    </div>
  );
}

type NativeSpacing = (typeof spacingTokens)[number];
type NativeRadius = (typeof radiusTokens)[number];
type NativeShadow = (typeof shadowTokens)[number];

function formatResolvedLength(value: string) {
  const pixels = Number.parseFloat(value);
  const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const rem = Number((pixels / rootSize).toFixed(3));
  return `${pixels}px / ${rem}rem`;
}

function SpacingTokenTile({ size }: { size: NativeSpacing }) {
  const token = `--mantine-spacing-${size}`;
  const barRef = useRef<HTMLDivElement>(null);
  const [resolvedValue, setResolvedValue] = useState("");

  useEffect(() => {
    if (!barRef.current) return;
    setResolvedValue(formatResolvedLength(getComputedStyle(barRef.current).width));
  }, [size]);

  return (
    <div className={classes.foundationTokenTile}>
      <div className={classes.foundationTokenMeta}>
        <code>{token}</code>
        <code>{resolvedValue || "…"}</code>
      </div>
      <div className={classes.spacingBarTrack}>
        <div ref={barRef} className={classes.spacingBar} style={{ width: `var(${token})` }} />
      </div>
    </div>
  );
}

function SpacingSpecimen({ title, spacing, children }: {
  title: string;
  spacing: NativeSpacing;
  children: ReactNode;
}) {
  return (
    <Paper p="md" radius="md" withBorder className={classes.foundationSurface}>
      <Stack gap="xs">
        <Group justify="space-between" gap="xs">
          <Text size="sm" fw={600} className={classes.pliegoText}>{title}</Text>
          <code>gap: {spacing}</code>
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}

function RadiusTokenTile({ size }: { size: NativeRadius }) {
  const token = `--mantine-radius-${size}`;
  const sampleRef = useRef<HTMLDivElement>(null);
  const [resolvedValue, setResolvedValue] = useState("");

  useEffect(() => {
    if (!sampleRef.current) return;
    setResolvedValue(formatResolvedLength(getComputedStyle(sampleRef.current).borderTopLeftRadius));
  }, [size]);

  return (
    <div className={classes.foundationTokenTile}>
      <div className={classes.foundationTokenMeta}>
        <code>{token}</code>
        <code>{resolvedValue || "…"}</code>
      </div>
      <div ref={sampleRef} className={classes.radiusTokenSample} style={{ borderRadius: `var(${token})` }} />
    </div>
  );
}

function DefaultRadiusReadout({ radius }: { radius: string | number }) {
  const sampleRef = useRef<HTMLDivElement>(null);
  const [resolvedValue, setResolvedValue] = useState("");

  useEffect(() => {
    if (!sampleRef.current) return;
    setResolvedValue(formatResolvedLength(getComputedStyle(sampleRef.current).borderTopLeftRadius));
  }, [radius]);

  return (
    <div className={classes.defaultRadiusReadout}>
      <div>
        <Text size="sm" fw={600} className={classes.pliegoText}>Current defaultRadius</Text>
        <code>{String(radius)} · {resolvedValue || "…"}</code>
      </div>
      <div ref={sampleRef} className={classes.defaultRadiusSample} style={{ borderRadius: "var(--mantine-radius-default)" }} />
    </div>
  );
}

function ShadowTokenTile({ size }: { size: NativeShadow }) {
  const token = `--mantine-shadow-${size}`;
  const sampleRef = useRef<HTMLDivElement>(null);
  const [resolvedValue, setResolvedValue] = useState("");

  useEffect(() => {
    if (!sampleRef.current) return;
    setResolvedValue(getComputedStyle(sampleRef.current).boxShadow);
  }, [size]);

  return (
    <div className={classes.foundationShadowTile}>
      <div ref={sampleRef} className={classes.shadowTokenSample} style={{ boxShadow: `var(${token})` }} />
      <div className={classes.foundationTokenMeta}>
        <code>{token}</code>
        <code className={classes.shadowResolvedValue}>{resolvedValue || "…"}</code>
      </div>
    </div>
  );
}

function ElevationPolicyItem({ title, value }: { title: string; value: string }) {
  return (
    <div className={classes.elevationPolicyItem}>
      <Text size="xs" fw={600} className={classes.pliegoText}>{title}</Text>
      <Text size="xs" className={classes.mutedText}>{value}</Text>
    </div>
  );
}

function ElevationConcept({ title, detail, shadow }: { title: string; detail: string; shadow?: NativeShadow }) {
  return (
    <Paper
      p="md"
      radius="md"
      withBorder
      className={classes.foundationConceptSurface}
      shadow={shadow}
    >
      <Text size="sm" fw={600} className={classes.pliegoText}>{title}</Text>
      <Text size="xs" className={classes.mutedText}>{detail}</Text>
    </Paper>
  );
}

function BookCardShell({ title, policy, shadow }: { title: string; policy: string; shadow?: NativeShadow }) {
  return (
    <div className={classes.bookCardShellColumn}>
      <Text size="xs" className={classes.mutedText}>{title}</Text>
      <Paper p="md" radius="md" withBorder className={classes.foundationSurface} shadow={shadow}>
        <Stack gap="sm">
          <Text size="lg" fw={600} className={classes.pliegoText}>Book title</Text>
          <Text size="sm" className={classes.mutedText}>Author name · Format</Text>
          <Text size="md" fw={600} className={classes.pliegoText}>$ —</Text>
          <Text size="xs" fw={600} className={classes.mutedText}>{policy}</Text>
        </Stack>
      </Paper>
    </div>
  );
}
