import type { CSSProperties } from "react";

export type MaterialSymbolName =
  | "account_balance" | "account_circle" | "add" | "add_shopping_cart" | "arrow_back" | "arrow_forward" | "check" | "check_circle"
  | "close" | "chevron_right" | "menu" | "menu_book" | "mobile" | "content_copy" | "credit_card" | "delete"
  | "edit" | "expand_less" | "expand_more" | "favorite" | "favorite_border" | "headphones"
  | "filter_list" | "lock" | "location_on" | "logout" | "format_paint" | "light_mode" | "dark_mode" | "brightness_auto" | "info"
  | "refresh" | "remove" | "search" | "shopping_bag" | "shopping_cart" | "shopping_cart_off"
  | "schedule" | "block" | "book_2" | "help" | "sell" | "error" | "mail" | "link_off"
  | "inventory_2" | "visibility" | "home" | "local_shipping";

interface MaterialSymbolProps {
  name: MaterialSymbolName;
  size?: number;
  fill?: boolean;
  context?: "default" | "header";
  className?: string;
  decorative?: boolean;
  "aria-label"?: string;
}

export function MaterialSymbol({ name, size = 20, fill = false, context = "default", className, decorative = true, "aria-label": label }: MaterialSymbolProps) {
  const displaySize = context === "header" ? 26 : size;
  const weight = context === "header" ? 500 : 400;
  const opticalSize = Math.min(48, Math.max(20, displaySize));
  const style: CSSProperties = {
    fontSize: displaySize,
    fontWeight: weight,
    fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'opsz' ${opticalSize}`,
  };
  return <span className={["material-symbol", context === "header" && "material-symbol--header", className].filter(Boolean).join(" ")} style={style} aria-hidden={decorative ? true : undefined} aria-label={decorative ? undefined : label} role={decorative ? undefined : "img"}>{name}</span>;
}
