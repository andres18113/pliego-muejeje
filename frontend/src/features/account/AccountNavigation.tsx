import { NavLink } from "react-router-dom";
import { MapPin, Package, UserRound } from "lucide-react";

export function AccountNavigation() {
  return <nav className="account-navigation" aria-label="Secciones de mi cuenta">
    <NavLink to="/account" end><UserRound aria-hidden="true" size={18} />Perfil</NavLink>
    <NavLink to="/account/addresses"><MapPin aria-hidden="true" size={18} />Direcciones</NavLink>
    <NavLink to="/orders"><Package aria-hidden="true" size={18} />Mis pedidos</NavLink>
  </nav>;
}
