import { useEffect, useRef, type ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { authLocation } from "@/features/auth/authLocation";
import { CatalogHeader } from "@/features/catalog/CatalogHeader";
import { readCatalogCriteria } from "@/features/catalog/catalogUrl";
import { SiteFooter } from "@/shared/ui/SiteFooter";

const emptyCriteria = readCatalogCriteria("");

export function PurchasePage({ title, compact = false, children }: { title: string; compact?: boolean; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · PLIEGO`;
  }, [title]);

  return (
    <>
      <CatalogHeader criteria={emptyCriteria} compact={compact} />
      <main className="purchase-route page-frame" id="contenido-principal" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * Renders purchase content only for a CUSTOMER session. Guests and expired sessions get a
 * sign-in path that returns to `intent`; ADMIN accounts get a role-denied state.
 */
export function CustomerOnly({
  intent,
  task,
  children,
}: {
  intent: string;
  task: string;
  children: ReactNode;
}) {
  const { session, expired } = useSession();
  const gateRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!session || session.user.role !== "CUSTOMER") gateRef.current?.focus({ preventScroll: true });
  }, [session, expired]);

  if (!session) {
    return (
      <section className="purchase-gate" aria-labelledby="purchase-gate-heading">
        <h1 id="purchase-gate-heading" ref={gateRef} tabIndex={-1}>
          {expired ? "Tu sesión ya no está activa." : `Inicia sesión para ${task}.`}
        </h1>
        <p>
          {expired
            ? `Vuelve a iniciar sesión para ${task}.`
            : "Usa tu cuenta de cliente. Después de iniciar sesión volverás a esta página."}
        </p>
        <div className="purchase-actions">
          <ButtonLink variant="primary" to={authLocation("/sign-in", intent)}>Iniciar sesión</ButtonLink>
          {!expired && <ButtonLink variant="text" to={authLocation("/register", intent)}>Crear cuenta</ButtonLink>}
        </div>
      </section>
    );
  }

  if (session.user.role !== "CUSTOMER") {
    return (
      <section className="purchase-gate" role="alert" aria-labelledby="purchase-gate-heading">
        <h1 id="purchase-gate-heading" ref={gateRef} tabIndex={-1}>Esta página no está disponible para tu cuenta.</h1>
        <p>Esta página está disponible únicamente para cuentas de cliente.</p>
        <div className="purchase-actions">
          <ButtonLink variant="secondary" to="/catalog">Ir al catálogo</ButtonLink>
        </div>
      </section>
    );
  }

  return <>{children}</>;
}
