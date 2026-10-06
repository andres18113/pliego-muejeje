import type { OwnedItem } from "@/shared/api/library";
import { orderStateLabel, paymentStateLabel } from "@/features/purchase/purchaseText";

const grantStateLabels: Record<OwnedItem["sourcePurchases"][number]["grantState"], string> = {
  ACTIVE: "Vigente",
  REVOKED: "Revocada",
};

export function toLibrarySourcePurchaseViewModel(source: OwnedItem["sourcePurchases"][number]) {
  return {
    ...source,
    orderStateLabel: orderStateLabel(source.orderState),
    paymentStateLabel: paymentStateLabel(source.paymentState),
    grantStateLabel: grantStateLabels[source.grantState],
  };
}

export const libraryRoutes = { list: "/biblioteca", detail: (id: string) => `/biblioteca/${encodeURIComponent(id)}` } as const;
export const libraryFilters = [{ value: "", label: "Todos" }, { value: "EBOOK", label: "eBooks" }, { value: "AUDIOBOOK", label: "Audiolibros" }] as const;
export function toOwnedItemViewModel(item: OwnedItem) {
  const metadata = item.metadata;
  return {
    ...item, detailHref: libraryRoutes.detail(item.ownedItemId), mediaLabel: item.productType === "EBOOK" ? "eBook" : "Audiolibro",
    ownershipLabel: item.ownershipState === "OWNED" ? "Pertenece a tu cuenta" : "Titularidad revocada",
    accessLabel: item.accessState === "OWNERSHIP_ONLY" ? "Registro de titularidad; acceso al contenido fuera de esta simulación" : "Titularidad revocada",
    sourcePurchases: item.sourcePurchases.map(toLibrarySourcePurchaseViewModel),
    bibliographicMetadata: [
      { label: "Editorial", value: metadata.publisher }, { label: "Idioma", value: metadata.language },
      ...(metadata.isbn ? [{ label: "ISBN", value: metadata.isbn }] : []),
      ...(metadata.pageCount !== null ? [{ label: "Páginas", value: String(metadata.pageCount) }] : []),
      ...(metadata.publicationDate ? [{ label: "Publicación", value: metadata.publicationDate }] : []),
      ...(metadata.ebookFileFormat ? [{ label: "Formato bibliográfico", value: metadata.ebookFileFormat }] : []),
      ...(metadata.audioDurationSeconds !== null ? [{ label: "Duración (segundos)", value: String(metadata.audioDurationSeconds) }] : []),
      ...(metadata.narrators.length ? [{ label: "Narración", value: metadata.narrators.join(", ") }] : []),
    ],
  };
}
export type OwnedItemViewModel = ReturnType<typeof toOwnedItemViewModel>;
