import { useEffect, useRef, useState } from "react";
import { Outlet, RouterProvider, ScrollRestoration, createBrowserRouter, isRouteErrorResponse, redirect, useLocation, useNavigation, useRouteError } from "react-router-dom";
import { CatalogHomePage } from "@/features/catalog/CatalogHomePage";
import { CatalogHeader } from "@/features/catalog/CatalogHeader";
import { readCatalogCriteria } from "@/features/catalog/catalogUrl";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "./session";

const emptyCriteria = readCatalogCriteria("");
const catalogCriteriaKeys = ["q", "scope", "category", "minPrice", "maxPrice", "language", "format", "sort", "page", "pageSize"];

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    HydrateFallback: InitialRouteFallback,
    ErrorBoundary: RouteErrorBoundary,
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
  const { restoreState, retryRestore } = useSession();
  if (restoreState === "restoring") return <InitialRouteFallback label="Comprobando tu sesión…" />;
  if (restoreState === "unavailable") {
    return (
      <main className="initial-route-loading" role="alert">
        <strong>PLIEGO</strong>
        <span>No pudimos comprobar tu sesión. Tu cuenta sigue protegida.</span>
        <Button variant="primary" type="button" onClick={() => void retryRestore()}>Reintentar</Button>
      </main>
    );
  }
  return <RouterProvider router={router} />;
}

function InitialRouteFallback({ label = "Abriendo tu página…" }: { label?: string }) {
  return <div className="initial-route-loading" role="status"><strong>PLIEGO</strong><span>{label}</span></div>;
}

function RootLayout() {
  usePageHeadingFocus();
  const navigation = useNavigation();
  const target = navigation.location?.pathname;
  const label = target === "/cart" ? "Abriendo carrito…" : target?.startsWith("/account") ? "Abriendo tu cuenta…" : target?.startsWith("/orders") ? "Abriendo tus pedidos…" : target === "/checkout" ? "Preparando la compra…" : "Cargando página…";

  return (
    <>
      {navigation.state !== "idle" && <div className="route-pending" role="status" aria-live="polite"><span className="route-pending-bar" aria-hidden="true" />{label}</div>}
      <Outlet />
      <ScrollRestoration />
    </>
  );
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
      <CatalogHeader criteria={emptyCriteria} />
      <main className="route-fallback page-frame" id="contenido-principal" tabIndex={-1}>
        <h1>{notFound ? "No encontramos esta página." : "No pudimos mostrar esta página."}</h1>
        <p>
          {notFound
            ? "Vuelve a explorar el catálogo completo."
            : "Ocurrió un problema al abrir esta página. Vuelve al catálogo e inténtalo otra vez."}
        </p>
      <ButtonLink variant="primary" to="/catalog">Ir al catálogo</ButtonLink>
      </main>
      <SiteFooter />
    </>
  );
}

function NotFoundPage() {
  useEffect(() => {
    document.title = "Página no encontrada · PLIEGO";
  }, []);

  return (
    <>
      <CatalogHeader criteria={emptyCriteria} />
      <main className="not-found page-frame" id="contenido-principal" tabIndex={-1}>
        <h1>No encontramos esta página.</h1>
        <p>Vuelve a explorar el catálogo completo.</p>
        <ButtonLink variant="primary" to="/catalog">Ir al catálogo</ButtonLink>
      </main>
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
      <CatalogHeader criteria={emptyCriteria} />
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
            <p>Vuelve al catálogo para continuar.</p>
            <ButtonLink variant="secondary" to="/catalog">Ir al catálogo</ButtonLink>
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
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (previousPathname.current === null) {
      previousPathname.current = pathname;
      if (pathname === "/") return;
    } else {
      if (previousPathname.current === pathname) return;
      previousPathname.current = pathname;
    }

    const heading = document.querySelector<HTMLElement>("#contenido-principal h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [pathname]);
}
