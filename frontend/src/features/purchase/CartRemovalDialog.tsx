import { useState } from "react";
import type { CartLine } from "@/shared/api/cart";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";

/**
 * The cart's one removal question, asked the same way in the drawer and on the cart page: the book is named, the
 * keeping answer is spelled out ("Conservar", never an ambiguous "Cancelar" next to an order), and nothing leaves the
 * cart until "Quitar" is pressed. What follows a confirmed removal ("Quitado del carrito" · Deshacer) belongs to the
 * caller. The dialog stays open, busy, until the server answers.
 */
export function CartRemovalDialog({ line, busy, zIndex, onConfirm, onKeep }: {
  line: CartLine | null;
  busy: boolean;
  zIndex?: number;
  onConfirm: (line: CartLine) => void;
  onKeep: (line: CartLine) => void;
}) {
  // The sheet keeps naming the book while it closes, instead of flashing an empty sentence.
  const [shown, setShown] = useState(line);
  if (line && line !== shown) setShown(line);
  return <ConfirmDialog opened={line !== null} zIndex={zIndex} title="¿Quitar del carrito?" pill destructive
    confirmLabel="Quitar" keepLabel="Conservar" busyLabel="Quitando…" busy={busy}
    onConfirm={() => { if (line && !busy) onConfirm(line); }}
    onKeep={() => { if (line) onKeep(line); }}>
    <p>Se quitará <strong>{shown?.title}</strong> de tu carrito.</p>
  </ConfirmDialog>;
}
