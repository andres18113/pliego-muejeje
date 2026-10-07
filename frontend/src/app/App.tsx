import { useEffect, useRef, useState } from "react";
import { CartPreviewProvider } from "@/features/purchase/CartPreview";
import { Link, Outlet, RouterProvider, ScrollRestoration, createBrowserRouter, isRouteErrorResponse, redirect, useLocation, useNavigation, useNavigationType, useRouteError } from "react-router-dom";
import { CatalogHomePage } from "@/features/catalog/CatalogHomePage";
import { SiteHeader } from "./navigation/SiteHeader";
import { PurchaseHeader } from "./navigation/PurchaseHeader";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { Button, ButtonLink } from "@/components/ui/button";
import { BrandLogo } from "@/shared/ui/BrandLogo";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { NotFoundScene } from "@/shared/ui/NotFoundScene";
import { useDelayedPending } from "@/shared/hooks/useDelayedPending";
import { SessionProvider, useSession } from "./session";

const catalogCriteriaKeys = ["que", "category", "minPrice", "maxPrice", "language", "format", "productType", "sort", "page", "pageSize"];

const developmentRoutes = import.meta.env.DEV
  ? [{
      path: "/dev/theme",
      HydrateFallback: InitialRouteFallback,
      lazy: async () => {
        const { ThemeInspectionPage } = await import("@/dev/ThemeInspectionPage");
        return { Component: ThemeInspectionPage };
      },
    }]
  : [];

export const router = createBrowserRouter([
  ...developmentRoutes,
  {
    path: "/",
    Component: RootSessionLayout,
    HydrateFallback: InitialRouteFallback,
    ErrorBoundary: RootRouteErrorBoundary,
    children: [
      {
        index: true,
        Component: CatalogHomePage,
        loader: ({ request }) => {
          const { search } = new URL(request.url);
          const params = new URLSearchParams(search);
          return catalogCriteriaKeys.some((key) => params.has(key))
            ? redirect(`/catalog${search}`)
            : null;
        },
      },
      {
        path: "catalog",
        lazy: async () => {
          const { CatalogPage } = await import("@/features/catalog/CatalogPage");
          return { Component: CatalogPage };
        },
      },
      {
        path: "ayuda",
        lazy: async () => { const { HelpPage } = await import("@/features/help/HelpRoutes"); return { Component: HelpPage }; },
      },
      {
        path: "ayuda/:slug",
        lazy: async () => { const { HelpArticlePage } = await import("@/features/help/HelpRoutes"); return { Component: HelpArticlePage }; },
      },
      {
        path: "biblioteca",
        lazy: async () => { const { LibraryPage } = await import("@/features/library/LibraryRoutes"); return { Component: LibraryPage }; },
      },
      {
        path: "biblioteca/:ownedItemId",
        lazy: async () => { const { OwnedItemPage } = await import("@/features/library/LibraryRoutes"); return { Component: OwnedItemPage }; },
      },
      {
        path: "ofertas",
        lazy: async () => {
          const { OffersPage } = await import("@/features/catalog/OffersPage");
          return { Component: OffersPage };
        },
      },
      {
        path: "catalog/editions/:editionId",
        lazy: async () => {
          const { EditionDetailPage } = await import("@/features/catalog/EditionDetailPage");
          return { Component: EditionDetailPage };
        },
      },
      {
        path: "sign-in",
        lazy: async () => {
          const { SignInPage } = await import("@/features/auth/AuthPages");
          return { Component: SignInPage };
        },
      },
      {
        path: "register",
        lazy: async () => {
          const { RegisterPage } = await import("@/features/auth/AuthPages");
          return { Component: RegisterPage };
        },
      },
      {
        path: "verificar-correo",
        lazy: async () => {
          const { VerifyEmailPage } = await import("@/features/auth/EmailActionPages");
          return { Component: VerifyEmailPage };
        },
      },
      {
        path: "reenviar-verificacion",
        lazy: async () => {
          const { ResendVerificationPage } = await import("@/features/auth/EmailActionPages");
          return { Component: ResendVerificationPage };
        },
      },
      {
        path: "recuperar-contrasena",
        lazy: async () => {
          const { ForgotPasswordPage } = await import("@/features/auth/EmailActionPages");
          return { Component: ForgotPasswordPage };
        },
      },
      {
        path: "restablecer-contrasena",
        lazy: async () => {
          const { ResetPasswordPage } = await import("@/features/auth/EmailActionPages");
          return { Component: ResetPasswordPage };
        },
      },
      {
        path: "account",
        lazy: async () => {
          const { AccountPage } = await import("@/features/account/AccountPage");
          return { Component: AccountPage };
        },
      },
      {
        path: "account/addresses",
        lazy: async () => {
          const { AddressBookPage } = await import("@/features/account/AddressBook");
          return { Component: AddressBookPage };
        },
      },
      {
        path: "favorites",
        lazy: async () => {
          const { FavoritesPage } = await import("@/features/favorites/FavoritesPage");
          return { Component: FavoritesPage };
        },
      },
      {
        path: "cart",
        lazy: async () => {
          const { CartPage } = await import("@/features/purchase/CartPage");
          return { Component: CartPage };
        },
      },
      {
        path: "checkout",
        lazy: async () => {
          const { CheckoutPage } = await import("@/features/purchase/CheckoutPage");
          return { Component: CheckoutPage };
        },
      },
      {
        path: "orders",
        lazy: async () => {
          const { OrdersPage } = await import("@/features/purchase/OrdersPage");
          return { Component: OrdersPage };
        },
      },
      {
        path: "orders/:orderId",
        lazy: async () => {
          const { OrderPage } = await import("@/features/purchase/OrderPage");
          return { Component: OrderPage };
        },
      },
      { path: "admin", Component: AdminWorkspacePage },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

function RootSessionLayout() {
  return (
    <SessionProvider>
      <RootLayout />
    </SessionProvider>
  );
}

function RootLayout() {
  const { restoreState, retryRestore } = useSession();
  if (restoreState === "restoring") return <InitialRouteFallback label="Comprobando tu sesión…" />;
  if (restoreState === "unavailable") {
    return (
      <main className="initial-route-loading" role="alert">
        <BrandLogo />
        <span>No pudimos comprobar tu sesión. Tu cuenta sigue protegida.</span>
        <Button variant="primary" type="button" onClick={() => void retryRestore()}>Reintentar</Button>
      </main>
    );
  }
  return <ApplicationLayout />;
}

function InitialRouteFallback({ label = "Abriendo tu página…" }: { label?: string }) {
  return <div className="initial-route-loading" role="status"><BrandLogo /><span>{label}</span></div>;
}

function ApplicationLayout() {
  usePageHeadingFocus();
  const navigation = useNavigation();
  const showRoutePending = useDelayedPending(navigation.state !== "idle");
  const target = navigation.location?.pathname;
  // Cart and checkout are the focused purchase flow: their own header, without catalog navigation or search.
  const pathname = useLocation().pathname;
  const purchaseFocused = pathname === "/cart" || pathname === "/checkout";
  const label = target === "/cart" ? "Abriendo carrito…" : target?.startsWith("/account") ? "Abriendo tu cuenta…" : target?.startsWith("/orders") ? "Abriendo tus pedidos…" : target === "/checkout" ? "Preparando la compra…" : "Cargando página…";

  return (
    <>
      {showRoutePending && <div className="route-pending" role="status" aria-live="polite">{label}</div>}
      {purchaseFocused ? <PurchaseHeader /> : <SiteHeader />}
      <CartPreviewProvider><Outlet /></CartPreviewProvider>
      <ScrollRestoration />
    </>
  );
}

function RootRouteErrorBoundary() {
  return <SessionProvider restoreOnMount={false}><RouteErrorBoundary /></SessionProvider>;
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  usePageHeadingFocus();

  useEffect(() => {
    document.title = notFound ? "Página no encontrada · PLIEGO" : "Error · PLIEGO";
  }, [notFound]);

  return (
    <>
      <SiteHeader />

      <RouteRecovery notFound={notFound} />
      <SiteFooter />
    </>
  );
}

/** The one recovery for a missing page or a failed route: PLIEGO's shared scene, and the way home. */
function RouteRecovery({ notFound }: { notFound: boolean }) {
  return <main className="route-fallback page-frame" id="contenido-principal" tabIndex={-1} data-storefront-surface>
    {notFound
      ? <NotFoundScene />
      : <NotFoundScene code={null} title="No pudimos mostrar esta página." detail="Ocurrió un problema al abrir esta página. Vuelve al inicio e inténtalo otra vez." />}
  </main>;
}

function NotFoundPage() {
  useEffect(() => {
    document.title = "Página no encontrada · PLIEGO";
  }, []);

  return (
    <>

      <RouteRecovery notFound />
      <SiteFooter />
    </>
  );
}

function AdminWorkspacePage() {
  const { session, logout } = useSession();
  const [logoutError, setLogoutError] = useState(false);

  useEffect(() => {
    document.title = "Área administrativa · PLIEGO";
  }, []);

  return (
    <>

      <main className="admin-placeholder page-frame" id="contenido-principal" tabIndex={-1}>
        {!session ? (
          <section role="alert">
            <h1>Inicia sesión para continuar.</h1>
            <p>El acceso a esta área requiere una sesión de administración.</p>
            <ButtonLink variant="primary" to="/sign-in">Iniciar sesión</ButtonLink>
          </section>
        ) : session.user.role !== "ADMIN" ? (
          <section role="alert">
            <h1>Esta área no está disponible para tu cuenta.</h1>
            <p>Vuelve al inicio para continuar.</p>
            <Link className="route-home" to="/"><MaterialSymbol name="arrow_back" aria-hidden="true" /><span>Ir al inicio</span></Link>
          </section>
        ) : (
          <section>
            <h1>Área administrativa</h1>
            <p>Tu sesión está activa. Las herramientas de administración aún no forman parte de esta versión del frontend.</p>
          {logoutError && <p role="alert">No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo otra vez.</p>}
          <Button variant="secondary" type="button" onClick={() => void logout().catch(() => setLogoutError(true))}>Cerrar sesión</Button>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

function usePageHeadingFocus() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (previousPathname.current === null) {
      previousPathname.current = pathname;
      if (pathname === "/") return;
    } else {
      if (previousPathname.current === pathname) return;
      previousPathname.current = pathname;
      if (pathname === "/catalog" && navigationType === "POP") return;
    }

    const main = document.getElementById("contenido-principal");
    if (!main) return;
    const startingFocus = document.activeElement;
    const focusHeading = () => {
      const heading = main.querySelector<HTMLElement>("h1");
      if (!heading) return false;
      const active = document.activeElement;
      // Late content supplies the reading position only while navigation still owns focus.
      // A user who has moved to another connected control keeps that position.
      if (active !== startingFocus && active !== document.body && active?.isConnected) return true;
      heading.tabIndex = -1;
    // The heading is only a reading position for assistive technology, never a control: mark this focus so
    // it draws no ring (styles.css). The mark leaves with the focus; keyboard focus on controls is unchanged.
      heading.setAttribute("data-route-focus", "");
      heading.addEventListener("blur", () => heading.removeAttribute("data-route-focus"), { once: true });
      heading.focus({ preventScroll: true });
      return true;
    };
    if (focusHeading()) return;
    const observer = new MutationObserver(() => { if (focusHeading()) observer.disconnect(); });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [navigationType, pathname]);
}
