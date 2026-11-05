import { Link } from "react-router-dom";
import type { OrderDetail } from "@/shared/api/orders";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./libraryAccessLink.module.css";

type OrderItem = OrderDetail["items"][number];

/**
 * Where a purchased title can be opened, or null. Only a digital line the server reports as AVAILABLE (ownership,
 * V077) on an approved, uncancelled order: physical books, pending payments, revoked or failed purchases get nothing.
 * The owned title itself, never a guess; an AVAILABLE line always carries its owned item.
 */
export function ownedTitleHref(order: Pick<OrderDetail, "orderState" | "payment">, item: OrderItem): string | null {
  const access = item.digitalAccess;
  if (item.requiresPhysicalFulfillment || access?.state !== "AVAILABLE") return null;
  if (order.orderState === "CANCELLED" || order.payment?.state !== "APPROVED") return null;
  return `/biblioteca/${access.ownedItemId}`;
}

/** The purchase's way into Mi biblioteca for one title: an ultramar outlined pill, named for its title. */
export function LibraryAccessLink({ order, item }: { order: Pick<OrderDetail, "orderState" | "payment">; item: OrderItem }) {
  const href = ownedTitleHref(order, item);
  if (!href) return null;
  // Named for its title (the visible words first), so a list of several reads apart; no hidden duplicate text.
  return <Link className={classes.pill} to={href} aria-label={`Ver en Mi biblioteca: ${item.title}`} data-library-access>
    <span>Ver en Mi biblioteca</span>
    <MaterialSymbol name="arrow_forward" aria-hidden="true" size={18} />
  </Link>;
}
