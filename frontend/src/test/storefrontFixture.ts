import type { StorefrontNavigation } from "@/shared/api/storefront";

export const storefrontNavigationFixture: StorefrontNavigation = {
  sections: [
    { key: "PHYSICAL", label: "Libros", href: "/catalog?productType=PHYSICAL" },
    { key: "EBOOK", label: "eBooks", href: "/catalog?productType=EBOOK" },
    { key: "AUDIOBOOK", label: "Audiolibros", href: "/catalog?productType=AUDIOBOOK" },
    { key: "OFFERS", label: "Ofertas", href: "/ofertas" },
    { key: "HELP", label: "Ayuda", href: "/ayuda" },
  ].map((section) => ({ ...section, key: section.key as StorefrontNavigation["sections"][number]["key"], featured: [], categories: [], allHref: section.href, bestSellingHref: null, offersHref: null, activeOfferCount: "0" })),
};
