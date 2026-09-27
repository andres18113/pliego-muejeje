import { useEffect, useRef } from "react";
import { Outlet, RouterProvider, ScrollRestoration, createBrowserRouter, isRouteErrorResponse, useLocation, useRouteError } from "react-router-dom";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { CatalogHeader } from "@/features/catalog/CatalogHeader";
import { readCatalogCriteria } from "@/features/catalog/catalogUrl";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { Button, ButtonLink } from "@/components/ui/button";
import { useSession } from "./session";

const emptyCriteria = readCatalogCriteria("");

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { index: true, Component: CatalogPage },
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
      { path: "admin", Component: AdminWorkspacePage },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

function RootLayout() {
  usePageHeadingFocus();

  return (
    <>
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
            ? "Vuelve al catálogo para seguir explorando las ediciones disponibles."
            : "Ocurrió un problema al abrir esta página. Vuelve al catálogo e inténtalo otra vez."}
        </p>
        <ButtonLink variant="primary" to="/">Ir al catálogo</ButtonLink>
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
        <p>Vuelve al catálogo para seguir explorando las ediciones disponibles.</p>
        <ButtonLink variant="primary" to="/">Ir al catálogo</ButtonLink>
      </main>
      <SiteFooter />
    </>
  );
}

function AdminWorkspacePage() {
  const { session, clear } = useSession();

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
            <ButtonLink variant="secondary" to="/">Ir al catálogo</ButtonLink>
          </section>
        ) : (
          <section>
            <h1>Área administrativa</h1>
            <p>Tu sesión está activa. Las herramientas de administración aún no forman parte de esta versión del frontend.</p>
          <Button variant="secondary" type="button" onClick={clear}>Cerrar sesión</Button>
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
