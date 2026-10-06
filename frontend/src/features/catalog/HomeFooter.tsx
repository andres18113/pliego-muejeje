import { Box } from "@mantine/core";
import { Link } from "react-router-dom";
import { AmericanExpressLogoIcon } from "react-svg-credit-card-payment-icons/americanexpress";
import { DinersClubLogoIcon } from "react-svg-credit-card-payment-icons/dinersclub";
import { MastercardLogoIcon } from "react-svg-credit-card-payment-icons/mastercard";
import { VisaLogoIcon } from "react-svg-credit-card-payment-icons/visa";
import { useHelpCategories } from "@/features/help/helpQuery";
import { useStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./homeFooter.module.css";

/** The storefront's own sections, in its order; the footer is not a second subject directory. */
const exploreKeys = ["PHYSICAL", "EBOOK", "AUDIOBOOK", "OFFERS"];
/** Help topics worth a place in the footer. Only those the Help API publishes are shown, under its own titles. */
const helpTopics = ["compras", "entrega-a-domicilio", "pagos"];
/** The card brands the payment dialog accepts, drawn with the same marks. */
const cardBrands = [
  { name: "Visa", Mark: VisaLogoIcon },
  { name: "Mastercard", Mark: MastercardLogoIcon },
  { name: "American Express", Mark: AmericanExpressLogoIcon },
  { name: "Diners Club", Mark: DinersClubLogoIcon },
];

export function HomeFooter() {
  const sections = useStorefrontNavigation().data?.sections ?? [];
  const topics = useHelpCategories().data ?? [];
  const explore = sections.filter(section => exploreKeys.includes(section.key));
  const help = sections.find(section => section.key === "HELP");
  const helpLinks = help ? helpTopics.flatMap(slug => topics.filter(topic => topic.slug === slug)) : [];
  return <Box component="footer" className={classes.footer}>
    <div className={classes.inner}>
      <div className={classes.top}>
        <div className={classes.brand}>
          <Link to="/" aria-label="PLIEGO, ir al inicio" className={classes.wordmark}>PLIEGO</Link>
          <p>Libros para mirar el mundo de otra manera.</p>
        </div>
        <nav aria-label="Navegación del pie de página" className={classes.navigation}>
          {explore.length > 0 && <div><h2>Explorar</h2>{explore.map(section => <Link key={section.key} to={section.href}>{section.label}</Link>)}</div>}
          <div><h2>Tu PLIEGO</h2><Link to="/biblioteca">Mi biblioteca</Link><Link to="/favorites">Favoritos</Link><Link to="/cart">Carrito</Link><Link to="/account">Mi cuenta</Link></div>
          {help && <div><h2>Ayuda</h2><Link to={help.href}>{help.label}</Link>{helpLinks.map(topic => <Link key={topic.slug} to={`${help.href}?category=${encodeURIComponent(topic.slug)}`}>{topic.title}</Link>)}</div>}
        </nav>
      </div>
      <div className={classes.payments}>
        <h2 id="footer-payments">Métodos de pago</h2>
        <ul aria-labelledby="footer-payments">
          {cardBrands.map(({ name, Mark }) => <li key={name}><span className={classes.card} role="img" aria-label={name}><Mark aria-hidden focusable={false} width={44} height={26} /></span></li>)}
          <li className={classes.transfer}><MaterialSymbol name="account_balance" size={22} />Transferencia bancaria</li>
        </ul>
      </div>
      <p className={classes.legal}>© 2026-2026 PLIEGO</p>
    </div>
  </Box>;
}
