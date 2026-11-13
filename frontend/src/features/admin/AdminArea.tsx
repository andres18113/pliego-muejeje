import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { Link, Outlet } from "react-router-dom";
import { ButtonLink } from "@/components/ui/button";
import { useSession } from "@/app/session";
import { AccountShell } from "@/features/account/AccountShell";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { SiteFooter } from "@/shared/ui/SiteFooter";
import { authLocation } from "@/features/auth/authLocation";
import { adminDateLabel } from "./adminModels";
import { useAdminCorrections, useAdminPickups } from "./adminQueries";
import classes from "./admin.module.css";

/**
 * The administration area (ADR 0047): reached from the account menu of an ADMIN session. The API decides every
 * permission (`/api/v1/admin/**` is ADMIN-only and each routine asserts it again); this gate only words who can
 * use the area. The pages are keyed by the session so another sign-in never shows the previous person's data.
 */
export function AdminArea() {
  const { session, expired, authorityVersion } = useSession();
  const gateRef = useRef<HTMLHeadingElement>(null);
  const allowed = session?.user.role === "ADMIN";
  useEffect(() => { if (!allowed) gateRef.current?.focus({ preventScroll: true }); }, [allowed, expired]);
  useEffect(() => { if (!allowed) document.title = "Administración · PLIEGO"; }, [allowed]);

  return <>
    <main className="purchase-route page-frame" id="contenido-principal" tabIndex={-1}>
      {!session ? <section className="purchase-gate" aria-labelledby="admin-gate-heading">
        <h1 id="admin-gate-heading" ref={gateRef} tabIndex={-1}>{expired ? "Tu sesión ya no está activa." : "Inicia sesión para administrar PLIEGO."}</h1>
        <p>El acceso a esta área requiere una sesión de administración.</p>
        <div className="purchase-actions"><ButtonLink variant="primary" to={authLocation("/sign-in", "/admin")}>Iniciar sesión</ButtonLink></div>
      </section> : !allowed ? <section className="purchase-gate" role="alert" aria-labelledby="admin-gate-heading">
        <h1 id="admin-gate-heading" ref={gateRef} tabIndex={-1}>Esta área no está disponible para tu cuenta.</h1>
        <p>Solo las cuentas de administración pueden usarla.</p>
        <div className="purchase-actions"><Link className="route-home" to="/"><MaterialSymbol name="arrow_back" aria-hidden="true" /><span>Ir al inicio</span></Link></div>
      </section> : <Fragment key={`${authorityVersion}:${session.user.userId}`}><Outlet /></Fragment>}
    </main>
    <SiteFooter />
  </>;
}

export function useAdminTitle(title: string) {
  useEffect(() => { document.title = `${title} · PLIEGO`; }, [title]);
}

/** One administration page: the Account trail and title, on the admin content axis. */
export function AdminPage({ title, intro, parent = true, parents, trail, children }: {
  title: string; intro?: ReactNode; parent?: boolean;
  /** Steps after "Administración" (e.g. Retiros en tienda on an order's page). */
  parents?: { label: string; to: string }[];
  /** The page's name in the trail when it differs from its title. */
  trail?: string;
  children: ReactNode;
}) {
  useAdminTitle(title);
  return <AccountShell title={title} intro={intro} trail={trail ?? title} trailWidth="1000px"
    trailParents={parent ? [{ label: "Administración", to: "/admin" }, ...(parents ?? [])] : undefined}>
    <div className={classes.page}>{children}</div>
  </AccountShell>;
}

/** Where the work is: each tool with what is waiting in it now, from the server's own counts. */
export function AdminOverviewPage() {
  const ready = useAdminPickups({ state: "READY", page: 0, pageSize: 1 });
  const preparing = useAdminPickups({ state: "PENDING", page: 0, pageSize: 1 });
  const corrections = useAdminCorrections({ status: "PENDING", page: 0, pageSize: 1 });
  const readyCount = ready.data ? Number(ready.data.totalCount) : null;
  const preparingCount = preparing.data ? Number(preparing.data.totalCount) : null;
  const pendingCount = corrections.data ? Number(corrections.data.totalCount) : null;
  const nextDue = corrections.data?.items[0]?.dueAt;

  return <AdminPage title="Administración" parent={false} intro="Atiende los retiros en tienda y revisa las solicitudes de los clientes.">
    <div className={classes.destinations}>
      <section className={`${classes.card} ${classes.destination}`} aria-labelledby="admin-pickups-link">
        <MaterialSymbol name="storefront" size={32} aria-hidden="true" />
        <h2><Link id="admin-pickups-link" to="/admin/retiros">Retiros en tienda</Link></h2>
        <p className={classes.metric}>{readyCount === null ? (ready.isError ? "No pudimos consultar los retiros." : "Consultando…")
          : readyCount === 0 ? "Ningún pedido listo para retirar" : readyCount === 1 ? "1 pedido listo para retirar" : `${readyCount} pedidos listos para retirar`}</p>
        {preparingCount !== null && preparingCount > 0 && <p className={classes.muted}>{preparingCount === 1 ? "1 en preparación" : `${preparingCount} en preparación`}</p>}
        <span className={classes.go} aria-hidden="true">Entregar pedidos<MaterialSymbol name="chevron_right" size={20} /></span>
      </section>
      <section className={`${classes.card} ${classes.destination}`} aria-labelledby="admin-corrections-link">
        <MaterialSymbol name="badge" size={32} aria-hidden="true" />
        <h2><Link id="admin-corrections-link" to="/admin/correcciones">Correcciones de identificación</Link></h2>
        <p className={classes.metric}>{pendingCount === null ? (corrections.isError ? "No pudimos consultar las solicitudes." : "Consultando…")
          : pendingCount === 0 ? "Ninguna solicitud por revisar" : pendingCount === 1 ? "1 solicitud por revisar" : `${pendingCount} solicitudes por revisar`}</p>
        {pendingCount !== null && pendingCount > 0 && adminDateLabel(nextDue) && <p className={classes.muted}>La más próxima vence el {adminDateLabel(nextDue)}.</p>}
        <span className={classes.go} aria-hidden="true">Revisar solicitudes<MaterialSymbol name="chevron_right" size={20} /></span>
      </section>
    </div>
  </AdminPage>;
}
