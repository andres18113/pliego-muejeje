import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { NavLink } from "react-router-dom";

export function AccountNavigation() {
  return <nav className="account-navigation" aria-label="Secciones de mi cuenta">
    <NavLink to="/account" end><MaterialSymbol name="account_circle" aria-hidden="true" size={18} />Perfil</NavLink>
    <NavLink to="/account/addresses"><MaterialSymbol name="location_on" aria-hidden="true" size={18} />Direcciones</NavLink>
    <NavLink to="/favorites"><MaterialSymbol name="favorite" aria-hidden="true" size={18} />Favoritos</NavLink>
    <NavLink to="/orders"><MaterialSymbol name="inventory_2" aria-hidden="true" size={18} />Mis pedidos</NavLink>
  </nav>;
}
