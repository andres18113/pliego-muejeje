import { Box, UnstyledButton } from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "@/app/session";
import { cartUnitCount, useCustomerCart } from "@/features/purchase/cartQuery";
import { BrandLogo } from "@/shared/ui/BrandLogo";
import site from "./SiteHeader.module.css";
import classes from "./PurchaseHeader.module.css";

/**
 * The focused header of the purchase flow: the wordmark and where the customer is, nothing else.
 * Catalog navigation, search and the account menu stay out; the page itself offers the way back to the catalog.
 */
export function PurchaseHeader() {
  const { session } = useSession();
  const location = useLocation();
  const place = location.pathname === "/checkout" ? "Finalizar Compra" : "Carrito";
  const cart = useCustomerCart(session?.user.role === "CUSTOMER", { fresh: false });
  const cachedUnits = cart.data ? cartUnitCount(cart.data.items) : null;
  const units = cart.isError && cachedUnits === 0 ? null : cachedUnits;

  return (
    <Box component="header" className={`${site.header} ${classes.header}`} data-purchase-header>
      <a className={site.skip} href="#contenido-principal" onClick={(event) => {
        const main = document.getElementById("contenido-principal");
        if (!main) return;
        event.preventDefault(); main.focus(); main.scrollIntoView({ block: "start", behavior: "instant" });
      }}>Saltar al contenido</a>
      <div className={classes.bar}>
        <UnstyledButton component={Link} to="/" className={site.wordmark} aria-label="PLIEGO, ir al inicio"><BrandLogo compact="phone" /></UnstyledButton>
        <p className={classes.title} aria-live={location.pathname === "/cart" ? undefined : "polite"}>
          {place}{units !== null && units > 0 && <span> ({units === 1 ? "1 artículo" : `${units} artículos`})</span>}
        </p>
      </div>
    </Box>
  );
}
