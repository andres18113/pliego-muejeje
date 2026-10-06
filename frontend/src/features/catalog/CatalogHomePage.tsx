import { useEffect } from "react";
import { HomeBenefits, HomeClosing } from "./HomeBenefits";
import { HomeDestinations } from "./HomeDestinations";
import { HomeDiscovery, HomePopular } from "./HomeDiscovery";
import classes from "./homePage.module.css";
import { HomeFooter } from "./HomeFooter";
import { useStorefrontNavigation } from "@/features/storefront/storefrontQuery";
import { useCatalogReturnScrollRestoration } from "./catalogScrollRestoration";

export function CatalogHomePage() {
  useEffect(() => {
    document.title = "Descubre el catálogo · PLIEGO";
  }, []);

  const navigationPending = useStorefrontNavigation().isPending;
  useCatalogReturnScrollRestoration(!navigationPending);

  return (
    <div className={classes.surface} data-storefront-surface>

      <main id="contenido-principal" tabIndex={-1} className={classes.home}>
        <HomeDiscovery />
        <div className={classes.shell}>
        <HomePopular />
        <HomeDestinations />
        <HomeBenefits />
        <HomeClosing />
        </div>
      </main>

      <HomeFooter />
    </div>
  );
}
