import { Link } from "react-router-dom";
import { useStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { HomeMascot } from "./HomeMascot";
import classes from "./homeDestinations.module.css";

/** Wording only: whether each destination exists, its name and where it leads come from the storefront projection. */
const copy = {
  OFFERS: { title: "Buenas lecturas, mejor precio.", line: "Libros, eBooks y audiolibros con precio especial por tiempo limitado.", action: "Ver ofertas" },
  HELP: { title: "¿Necesitas ayuda?", line: "Encuentra respuestas sobre compras, entregas, eBooks, audiolibros y tu cuenta.", action: "Ir a Ayuda" },
} as const;

/**
 * 3 · Two ways onward, side by side: Ofertas, the page's ultramar moment, drawn with one very large percent sign;
 * and Ayuda, where PLIEGO's character waits with a question. No covers and no prices: nothing here is merchandise.
 */
export function HomeDestinations() {
  const navigation = useStorefrontNavigation();
  const cards = (navigation.data?.sections ?? []).filter((section): section is typeof section & { key: keyof typeof copy } => section.key in copy);
  if (cards.length === 0) return null;
  return <section className={classes.destinations} aria-label="Ofertas y ayuda" data-count={cards.length}>
    {cards.map(section => {
      const text = copy[section.key];
      return <div key={section.key} className={classes.card} data-destination={section.key}>
        <div className={classes.copy}>
          <p className={classes.eyebrow}>{section.label}</p>
          <h2>{text.title}</h2>
          <p className={classes.line}>{text.line}</p>
          <Link to={section.href} className={classes.action}><span>{text.action}</span><MaterialSymbol name="arrow_forward" size={20} /></Link>
        </div>
        {section.key === "OFFERS"
          ? <div className={classes.art} aria-hidden="true"><span className={classes.percent}>%</span></div>
          : <div className={classes.art} aria-hidden="true">
            <span className={classes.helper}><HomeMascot className={classes.mascot} /><span className={classes.question}>?</span></span>
          </div>}
      </div>;
    })}
  </section>;
}
