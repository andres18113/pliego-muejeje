import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/features/catalog/formatters";

export function TransferFacts({ details, amount, reference }: {
  details: { bank: string; beneficiary: string; accountType: string; accountNumber: string; identification: string };
  amount: string;
  reference?: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const rows = [
    ["Banco", details.bank], ["Beneficiario", details.beneficiary], ["Tipo de cuenta", details.accountType],
    ["Número de cuenta", details.accountNumber], ["RUC / identificación", details.identification],
    ["Importe exacto", formatUsd(amount)], ...(reference ? [["Referencia", reference]] : []),
  ];
  return <dl className="transfer-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd>{["Número de cuenta", "Referencia"].includes(label) && <Button variant="text" type="button" aria-label={`Copiar ${label.toLowerCase()}`} onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(label)).catch(() => setCopied(null))}><Copy aria-hidden="true" size={15} />{copied === label ? "Copiado" : "Copiar"}</Button>}</div>)}</dl>;
}
