import { Link } from "react-router-dom";
import { useStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import type { StorefrontSection } from "@/shared/api/storefront";
import { MaterialSymbol, type MaterialSymbolName } from "@/shared/ui/MaterialSymbol";
import classes from "./homeBenefits.module.css";

interface Benefit { key: string; symbol: MaterialSymbolName; title: string; line: string; action: string; section: StorefrontSection["key"] | null }
/** What PLIEGO offers, in four plain statements. Wording only: each link is the projection's destination for its section. */
const benefits: Benefit[] = [
  { key: "catalog", symbol: "menu_book", title: "Todo en un solo lugar.", line: "Libros, eBooks y audiolibros reunidos en una sola tienda.", action: "Ver todo el catálogo", section: null },
  { key: "shipping", symbol: "local_shipping", title: "Envío gratis.", line: "Recibe tus libros en casa sin pagar por el envío.", action: "Explorar libros", section: "PHYSICAL" },
  { key: "offers", symbol: "sell", title: "Ofertas que sí valen la pena.", line: "Encuentra oportunidades en libros, eBooks y audiolibros.", action: "Ver ofertas", section: "OFFERS" },
  { key: "help", symbol: "help", title: "Ayuda cuando la necesites.", line: "Respuestas claras sobre compras, envíos, eBooks, audiolibros y tu cuenta.", action: "Ir a Ayuda", section: "HELP" },
];

/** 4 · Why PLIEGO: the page's quiet close. Four white cards on the paper — a symbol, a statement, one line, one text link. */
export function HomeBenefits() {
  const sections = useStorefrontNavigation().data?.sections ?? [];
  const destination = (benefit: Benefit) => benefit.section === null ? "/catalog" : sections.find(section => section.key === benefit.section)?.href;
  return <section className={classes.benefits} aria-labelledby="benefits-heading">
    <div className={classes.intro}>
      <h2 id="benefits-heading">¿Por qué comprar en PLIEGO?</h2>
      <p>Todo lo relacionado con libros en un solo lugar.</p>
    </div>
    <ul className={classes.cards}>{benefits.map(benefit => {
      const href = destination(benefit);
      return <li key={benefit.key} className={classes.card}>
        <MaterialSymbol name={benefit.symbol} size={36} fill className={classes.symbol} />
        <h3>{benefit.title}</h3>
        <p>{benefit.line}</p>
        {href && <Link to={href} className={classes.link}><span>{benefit.action}</span><MaterialSymbol name="chevron_right" size={20} /></Link>}
      </li>;
    })}</ul>
  </section>;
}

/** 5 · The Home's last word before the footer: one calm card that sends the reader back to the books. */
export function HomeClosing() {
  return <section className={classes.closing} aria-labelledby="closing-heading">
    <div className={classes.closingCard}>
      <h2 id="closing-heading">Ya está. Ahora solo falta encontrar tu próxima historia.</h2>
      <p><MaterialSymbol name="check_circle" size={22} />¡Muchas gracias!</p>
    </div>
  </section>;
}
