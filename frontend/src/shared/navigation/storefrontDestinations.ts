import type { EditionSearch } from "@/shared/api/catalog";

export const storefrontDestinations = [
  { id: "books", label: "Libros", href: "/catalog", format: "" },
  { id: "ebooks", label: "eBooks", href: "/catalog?format=EBOOK", format: "EBOOK" },
  { id: "audio", label: "Audiolibros", href: "/catalog?format=AUDIOBOOK", format: "AUDIOBOOK" },
  { id: "offers", label: "Ofertas", href: "/ofertas", format: "" },
] as const satisfies readonly { id: string; label: string; href: string; format: EditionSearch["format"] }[];
