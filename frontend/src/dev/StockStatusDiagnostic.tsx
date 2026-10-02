import { useState } from "react";
import { Button, Paper, Text, Title } from "@mantine/core";
import { BookCardStockPreview } from "./BookCardDiagnostic";
import { bookCardFixtures } from "./bookCardFixtures";
import { StockStatusSpecimen } from "./StockStatusSpecimen";
import { resolveStockStatus, type StockStatusInput } from "./stockStatusModel";
import layout from "./ThemeInspectionPage.module.css";
import classes from "./StockStatusDiagnostic.module.css";

const states: { name: string; input: StockStatusInput }[] = [
  { name: "Edición disponible", input: { available: true } },
  { name: "Sin disponibilidad · causa no informada", input: { available: false } },
  { name: "Carrito · cantidad no cubierta", input: { available: false, unavailabilityReason: "P3002" } },
  { name: "Carrito · edición inactiva", input: { available: false, unavailabilityReason: "P2042" } },
  { name: "Carrito · libro inactivo", input: { available: false, unavailabilityReason: "P2043" } },
];

export function StockStatusDiagnostic() {
  const [available, setAvailable] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  function simulateChange() {
    const next = !available;
    setAvailable(next);
    setAnnouncement(`Cien años de soledad: ${resolveStockStatus({ available: next }).label}.`);
  }

  return <section id="stockstatus-v1" className={`${layout.section} ${layout.layoutSection} ${classes.section}`} aria-labelledby="stockstatus-v1-title" data-stockstatus-diagnostic>
    <div className={layout.sectionHeading}>
      <Title order={2} id="stockstatus-v1-title">StockStatus v1 · disponibilidad de ediciones</Title>
      <Text size="sm" className={classes.muted}>Dos estados del API: disponible y no disponible. El carrito puede explicar tres causas de indisponibilidad. No se infieren cantidades, reservas, reposición ni entrega.</Text>
    </div>
    <div className={`${layout.layoutShell} ${layout.shell1440}`}>
      <Title order={3}>Dentro de BookCard v1</Title>
      <Text size="sm" className={classes.muted}>Misma anatomía, grid 2/3/4/5/6, shell y anchos aprobados. Bibliografía real de PLIEGO; disponibilidad alternada para inspección, sin consultar ni modificar el API.</Text>
      <ul className={`${layout.catalogLayoutGrid} ${classes.grid}`} aria-label="BookCards con StockStatus" data-stockstatus-bookcards>
        {bookCardFixtures.map((edition, index) => <li key={edition.editionId} className={classes.item}>
          <BookCardStockPreview edition={{ ...edition, available: index % 2 === 0 }} />
        </li>)}
      </ul>

      <div className={classes.block}>
        <Title order={3}>Estados y causas del contrato actual</Title>
        <Text size="sm" className={classes.muted}>Compact y normal mantienen el mismo mensaje. Sólo cambia la escala tipográfica y del símbolo. Una causa recibida se muestra completa en ambos tamaños.</Text>
        <div className={classes.matrix} data-stockstatus-matrix>
          {states.map(({ name, input }, index) => <div key={name} className={classes.case} data-stockstatus-case={index}>
            <Text component="h4" size="sm" fw={600}>{name}</Text>
            <div className={classes.sizes}>
              <div><Text size="xs" className={classes.muted}>Compact · 12/16 · símbolo 16px</Text><StockStatusSpecimen {...input} size="compact" /></div>
              <div><Text size="xs" className={classes.muted}>Normal · 14/20 · símbolo 20px</Text><StockStatusSpecimen {...input} /></div>
            </div>
          </div>)}
        </div>
      </div>

      <Paper component="section" p="md" radius="md" withBorder className={classes.surface} aria-labelledby="stockstatus-surface-title" data-stockstatus-surface>
        <Title order={3} id="stockstatus-surface-title">Cien años de soledad</Title>
        <Text size="sm" className={classes.muted}>Gabriel García Márquez · Debolsillo · Tapa dura · Español</Text>
        <StockStatusSpecimen available={available} id="stockstatus-surface-value" />
        <Text size="sm" className={classes.muted}>Ejemplo de cambio confirmado por una lectura del API. El anuncio pertenece a la superficie, no a cada instancia de StockStatus.</Text>
        <Button type="button" variant="default" onClick={simulateChange} aria-describedby="stockstatus-surface-value">Simular cambio de disponibilidad</Button>
        <Text size="sm" role="status" aria-live="polite" aria-atomic="true" data-stockstatus-announcement>{announcement}</Text>
      </Paper>

      <div className={classes.block}>
        <Title order={3}>Semántica y límites</Title>
        <Text size="sm" className={classes.muted}>StockStatus es texto informativo, sin foco, botón, tooltip ni live region propio. El símbolo es decorativo; la información siempre está escrita. Una lectura pendiente, fallida o desactualizada se comunica a nivel de página, sin inventar un tercer estado de stock.</Text>
        <Text size="sm" className={classes.muted}>P3002 describe la cantidad solicitada en carrito: puede haber unidades disponibles para comprar individualmente. P2042 y P2043 describen una edición o libro inactivo. Un pedido, permiso de cuenta o portada ausente no determina el stock.</Text>
      </div>
    </div>
  </section>;
}
