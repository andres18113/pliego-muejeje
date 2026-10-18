import { Box, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "@/app/session";
import { cartUnitCount, useCustomerCart } from "@/features/purchase/cartQuery";
import { BrandLogo } from "@/shared/ui/BrandLogo";
import { BackButton } from "./BackButton";
import { HeaderAccount } from "./HeaderAccount";
import site from "./SiteHeader.module.css";
import classes from "./PurchaseHeader.module.css";
import backClasses from "./BackNavigation.module.css";

/**
 * The focused header of the purchase flow: the wordmark, where the customer is, and their account.
 * Catalog navigation and search stay out; the page itself offers the way back to the catalog.
 */
export function PurchaseHeader() {
  const { session } = useSession();
  const [accountOpened, setAccountOpened] = useState(false);
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
        <div className={backClasses.primary}><BackButton closeLayer={accountOpened ? () => setAccountOpened(false) : undefined} />
        <UnstyledButton component={Link} to="/" className={site.wordmark} aria-label="PLIEGO, ir al inicio"><BrandLogo compact="phone" /></UnstyledButton></div>
        <p className={classes.title} aria-live={location.pathname === "/cart" ? undefined : "polite"}>
          {place}{units !== null && units > 0 && <span> ({units === 1 ? "1 artículo" : `${units} artículos`})</span>}
        </p>
        <nav aria-label="Cuenta" className={classes.account}>
          <HeaderAccount opened={accountOpened} onChange={setAccountOpened} />
        </nav>
      </div>
    </Box>
  );
}
