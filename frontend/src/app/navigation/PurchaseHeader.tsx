import { Box, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "@/app/session";
import { cartUnitCount, useCustomerCart } from "@/features/purchase/cartQuery";
import { BrandLogo } from "@/shared/ui/BrandLogo";
import { HeaderAccount } from "./HeaderAccount";
import site from "./SiteHeader.module.css";
import classes from "./PurchaseHeader.module.css";

/**
 * The focused header of the purchase flow: the wordmark, where the customer is, and their account.
 * Catalog navigation and search stay out; the page itself offers the way back to the catalog.
 */
export function PurchaseHeader() {
  const { session } = useSession();
  const [accountOpened, setAccountOpened] = useState(false);
  const place = useLocation().pathname === "/checkout" ? "Finalizar Compra" : "Carrito";
  const cart = useCustomerCart(session?.user.role === "CUSTOMER", { fresh: false });
  const units = cart.data ? cartUnitCount(cart.data.items) : null;

  return (
    <Box component="header" className={`${site.header} ${classes.header}`} data-purchase-header>
      <a className={site.skip} href="#contenido-principal" onClick={(event) => {
        const main = document.getElementById("contenido-principal");
        if (!main) return;
        event.preventDefault(); main.focus(); main.scrollIntoView({ block: "start", behavior: "instant" });
      }}>Saltar al contenido</a>
      <div className={classes.bar}>
        <UnstyledButton component={Link} to="/" className={site.wordmark} aria-label="PLIEGO, ir al inicio"><BrandLogo compact="phone" /></UnstyledButton>
        <p className={classes.title} aria-live="polite">
          {place}{units !== null && units > 0 && <span> ({units === 1 ? "1 artículo" : `${units} artículos`})</span>}
        </p>
        <nav aria-label="Cuenta" className={classes.account}>
          <HeaderAccount opened={accountOpened} onChange={setAccountOpened} />
        </nav>
      </div>
    </Box>
  );
}
