import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Anchor, Paper, Select, Text, Title } from "@mantine/core";
import type { EditionSummary } from "@/shared/api/catalog";
import { formatEdition, formatLanguage, formatUsd } from "@/features/catalog/formatters";
import { bookCardFixtures } from "./bookCardFixtures";
import layout from "./ThemeInspectionPage.module.css";
import classes from "./BookCardDiagnostic.module.css";
import { StockStatusSpecimen } from "./StockStatusSpecimen";
import { BookCard } from "@/features/catalog/BookCard";
import { toBookCardData as presentEdition, type BookCardData, type BookCardFeedback, type FavoriteControl, type CartControl } from "@/features/catalog/bookCardModel";

// This entire module is a development probe, never a production component.
type Scenario = "customer" | "guest" | "admin" | "favorite-read" | "pending" | "error" | "unknown";
const edgeCases: { label: string; edition: EditionSummary }[] = [
  { label: "Sin portada", edition: { ...bookCardFixtures[0], coverUrl: null } },
  { label: "Error de imagen", edition: { ...bookCardFixtures[1], coverUrl: "https://covers.pliegolibros.com/bookcard-diagnostic-missing.webp" } },
  { label: "Carga lenta", edition: { ...bookCardFixtures[2], coverUrl: `${bookCardFixtures[2].coverUrl}?bookcard-diagnostic=slow` } },
  { label: "Varios autores", edition: bookCardFixtures[3] },
  { label: "Editorial larga", edition: bookCardFixtures[4] },
  { label: "No disponible", edition: { ...bookCardFixtures[5], available: false } },
  { label: "Mismo título · Limusa", edition: bookCardFixtures[6] },
  { label: "Mismo título · Pearson", edition: bookCardFixtures[7] },
  { label: "Precio máximo permitido", edition: { ...bookCardFixtures[8], price: "999999999.99" } },
  { label: "Precio mínimo permitido", edition: { ...bookCardFixtures[9], price: "0.01" } },
  { label: "URL rechazada", edition: { ...bookCardFixtures[10], coverUrl: "http://localhost/cover.webp" } },
  { label: "Créditos · ejemplo técnico", edition: { ...bookCardFixtures[11], coverLicense: "Licencia de prueba", coverAttribution: "Crédito de diagnóstico con texto extenso para comprobar su lectura sin truncar; no representa derechos reales" } },
];

export function BookCardDiagnostic() {
  const [params] = useSearchParams();
  const [dataset, setDataset] = useState(params.get("bookcard-data") === "edges" ? "edges" : "catalog");
  const [scenario, setScenario] = useState<Scenario>("customer");
  const previewId = params.get("bookcard");
  const previewRef = useRef<HTMLHeadingElement>(null);
  const [geometry, setGeometry] = useState({ width: 0, columns: 0, cardWidth: 0 });
  const gridRef = useRef<HTMLUListElement>(null);
  const cases = dataset === "edges" ? edgeCases : bookCardFixtures.map((edition) => ({ label: "", edition }));
  const preview = cases.find(({ edition }) => edition.editionId === previewId)?.edition;

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => setGeometry({
      width: window.innerWidth,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      cardWidth: grid.firstElementChild?.getBoundingClientRect().width ?? 0,
    });
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => { if (previewId) previewRef.current?.focus(); }, [previewId]);

  return (
    <section id="bookcard-v1" className={`${layout.section} ${layout.layoutSection} ${classes.section}`} aria-labelledby="bookcard-v1-title" data-bookcard-diagnostic>
      <div className={layout.sectionHeading}>
        <Title order={2} id="bookcard-v1-title">BookCard v1 · diagnóstico de dominio</Title>
        <Text size="sm" className={classes.muted}>Componente real de producción. Bibliografía y portadas reales del catálogo PLIEGO; IDs de diagnóstico y precio USD 20,00/disponibilidad del seed de desarrollo. Los casos límite son variaciones explícitas.</Text>
      </div>
      <div className={`${layout.layoutShell} ${layout.shell1440}`}>
        <div className={classes.controls}>
          <Select label="Datos del diagnóstico" value={dataset} onChange={(value) => setDataset(value ?? "catalog")} allowDeselect={false} data={[
            { value: "catalog", label: "Catálogo real · 12 ediciones" },
            { value: "edges", label: "Casos límite · 12 variaciones" },
          ]} />
          <Select label="Escenario de acciones" value={scenario} onChange={(value) => setScenario((value ?? "customer") as Scenario)} allowDeselect={false} data={[
            { value: "customer", label: "Cliente · éxito local" }, { value: "guest", label: "Invitado · requiere sesión" },
            { value: "admin", label: "Administrador · acceso restringido" }, { value: "favorite-read", label: "Favoritos sin confirmar" },
            { value: "pending", label: "Comando pendiente" }, { value: "error", label: "Comando rechazado" },
            { value: "unknown", label: "Carrito · resultado incierto" },
          ]} />
          <Text size="xs" className={classes.muted} data-bookcard-geometry>{geometry.width}px · {geometry.columns} columnas · tarjeta {Math.round(geometry.cardWidth)}px · gap 16px</Text>
        </div>
        <Text size="sm" className={classes.note}>Las acciones simulan estados en memoria. El enlace abre una vista completa dentro de este diagnóstico. No se envían comandos al API. Sin descuentos, etiquetas de novedad ni cantidades de stock: el contrato público no aporta esos datos.</Text>
        {scenario === "favorite-read" && <Text size="sm" role="status" className={classes.note}>No pudimos consultar tus favoritos. Actualiza la consulta antes de intentar cambiarlos.</Text>}
        <ul ref={gridRef} className={`${layout.catalogLayoutGrid} ${classes.grid}`} aria-label="Ediciones de diagnóstico BookCard" data-bookcard-grid>
          {cases.map(({ label, edition }) => (
            <li key={`${dataset}-${edition.editionId}-${scenario}`} className={classes.item}>
              {label && <Text size="xs" className={classes.caseLabel}>{label}</Text>}
              <BookCardSpecimen book={presentEdition(edition)} scenario={scenario} dataset={dataset} />
            </li>
          ))}
        </ul>
        {preview && <Paper component="section" p="md" radius="md" withBorder className={classes.preview} id="bookcard-preview" aria-labelledby="bookcard-preview-title" data-bookcard-preview>
          <Title ref={previewRef} order={3} id="bookcard-preview-title" tabIndex={-1}>{preview.title}</Title>
          <Text>{preview.authors}</Text>
          <Text>{preview.publisher} · {formatEdition(preview.format)} · {formatLanguage(preview.language)}</Text>
          <Text fw={600}>{formatUsd(preview.price)}</Text>
          <StockStatusSpecimen available={preview.available} />
          <Text size="sm" className={classes.muted}>Vista completa de diagnóstico; la tarjeta de producción abre la ruta de edición existente y conservará el contexto del catálogo.</Text>
          <Anchor component={Link} to="/dev/theme#bookcard-v1">Volver al diagnóstico</Anchor>
        </Paper>}
        <div className={classes.contractNotes}>
          <Title order={3}>Decisiones del contrato</Title>
          <Text size="sm">Portada íntegra 2:3; título, autores y editorial hasta dos líneas cada uno; formato e idioma visibles; precio exacto y disponibilidad textual. Una navegación por tarjeta, dos acciones hermanas de 44px, presentes con ratón, teclado y tacto.</Text>
          <Text size="sm">La tarjeta usa Paper, Anchor, Text, Button, ActionIcon y Tooltip de Mantine con los tokens aprobados. El grid conserva 2/3/4/5/6 columnas; el componente real consume las foundations aprobadas.</Text>
        </div>
      </div>
    </section>
  );
}

export function BookCardStockPreview({ edition }: { edition: EditionSummary }) {
  return <BookCardSpecimen book={presentEdition(edition)} scenario="customer" dataset="catalog" />;
}

function BookCardSpecimen({ book, scenario, dataset }: { book: BookCardData; scenario: Scenario; dataset: string }) {
  const [favorite, setFavorite] = useState(false);
  const [cartAdded, setCartAdded] = useState(false);
  const [cartUnavailable, setCartUnavailable] = useState(false);
  const [cartUnknown, setCartUnknown] = useState(false);
  const [feedback, setFeedback] = useState<BookCardFeedback | null>(null);
  function act(kind: "favorite" | "cart") {
    if (scenario === "guest") setFeedback({ kind: "success", message: "Inicia sesión como cliente para continuar. Tu intención se conserva en el flujo de producción." });
    else if (scenario === "error") {
      if (kind === "cart") setCartUnavailable(true);
      setFeedback({ kind: "error", message: kind === "favorite" ? "No pudimos actualizar tus favoritos. Inténtalo otra vez." : "Esta edición ya no está disponible para agregar al carrito." });
    } else if (scenario === "unknown" && kind === "cart") {
      setCartUnknown(true);
      setFeedback({ kind: "error", message: "No pudimos confirmar el carrito. Consúltalo antes de volver a intentarlo." });
    } else if (kind === "favorite") {
      setFavorite(!favorite);
      setFeedback({ kind: "success", message: favorite ? "Quitado de favoritos." : "Agregado a favoritos." });
    } else { setCartAdded(true); setFeedback({ kind: "success", message: "Agregado al carrito." }); }
  }
  const favoriteControl: FavoriteControl = scenario === "admin" ? { state: "restricted", reason: "Acciones disponibles para cuentas de cliente." }
    : scenario === "favorite-read" ? { state: "unconfirmed", reason: "Favoritos sin confirmar." }
      : scenario === "pending" ? { state: "pending", selected: favorite }
        : { state: "ready", selected: favorite, onPress: () => act("favorite") };
  const cartControl: CartControl = scenario === "admin" ? { state: "restricted", reason: "Acciones disponibles para cuentas de cliente." }
    : cartUnknown ? { state: "uncertain", recoveryTo: "/cart" }
      : scenario === "pending" ? { state: "pending" }
        : { state: cartAdded ? "success" : "ready", onPress: () => act("cart") };
  return <BookCard book={{ ...book, available: book.available && !cartUnavailable }}
    to={`/dev/theme?bookcard=${encodeURIComponent(book.id)}${dataset === "edges" ? "&bookcard-data=edges" : ""}#bookcard-preview`}
    favorite={favoriteControl} cart={cartControl} feedback={feedback} />;
}
