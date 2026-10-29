import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useSession } from "@/app/session";
import { billingIdentityQueryKey, getBillingIdentity } from "@/shared/api/customer";
import { orderShortDateLabel } from "@/features/purchase/purchaseText";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./help.module.css";

/** The correction page's address; a literal so the Help chunk does not load the Account page. */
const correctionPath = "/account/identity";

/**
 * On the public "Cédula o RUC" article, a signed-in customer whose correction is in review sees that request: its
 * state, the server's own answer date and the way to it. A guest, staff, a customer without a pending request, a
 * failed read or a date that cannot be read show nothing — never a cached, generic or made-up deadline.
 */
export function IdentityRequestStatus() {
  const { session } = useSession();
  const customer = session?.user.role === "CUSTOMER";
  const query = useQuery({
    queryKey: billingIdentityQueryKey, queryFn: ({ signal }) => getBillingIdentity(signal),
    meta: { authRequired: true }, enabled: customer, refetchOnMount: "always", retry: false,
  });
  // Only what this visit read: an earlier cached answer may describe a request decided or withdrawn since.
  const request = customer && query.isFetchedAfterMount && !query.isError ? query.data?.correctionRequest : null;
  if (request?.status !== "PENDING" || Number.isNaN(new Date(request.dueAt).valueOf())) return null;
  return <section className={classes.personal} aria-labelledby="help-personal-heading">
    <div className={classes.personalHead}>
      <h2 id="help-personal-heading">Tu solicitud de corrección</h2>
      <span className={classes.reviewChip}>En revisión</span>
    </div>
    <p className={classes.personalDue}>Respuesta antes del <strong>{orderShortDateLabel(request.dueAt)}</strong></p>
    <Link to={correctionPath} className={classes.personalLink}>Ver solicitud<MaterialSymbol name="chevron_right" aria-hidden="true" size={20} /></Link>
  </section>;
}
