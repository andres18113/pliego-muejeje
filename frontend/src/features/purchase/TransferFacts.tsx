import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/features/catalog/formatters";

type CopyableFact = { key: string; label: string; value: string; prominent?: boolean };

export function TransferFacts({ details, amount, reference }: {
  details: { bank: string; beneficiary: string; accountType: string; accountNumber: string; identification: string };
  amount: string;
  reference?: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const rows: CopyableFact[] = [
    { key: "account", label: "Número de cuenta", value: details.accountNumber, prominent: true },
    { key: "beneficiary", label: "Beneficiario", value: details.beneficiary },
    { key: "identification", label: "Identificación", value: details.identification },
    { key: "amount", label: "Monto exacto", value: formatUsd(amount), prominent: true },
    ...(reference ? [{ key: "reference", label: "Referencia", value: reference, prominent: true }] : []),
  ];

  async function copy(label: string, value: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setCopyError(null);
    } catch {
      setCopied(null);
      setCopyError(label);
    }
  }

  return (
    <div className="transfer-facts-card">
      <div className="transfer-bank-heading">
        <span className="transfer-bank-icon"><MaterialSymbol name="account_balance" aria-hidden="true" size={18} /></span>
        <span className="transfer-bank-name"><small>Banco</small><strong>{details.bank}</strong></span>
        <span className="transfer-account-type">Cuenta {details.accountType.toLocaleLowerCase("es-EC")}</span>
      </div>
      <dl className="transfer-facts">
        {rows.map((row) => (
          <div className={`transfer-fact${row.prominent ? " transfer-fact--prominent" : ""}`} key={row.key}>
            <dt>{row.label}</dt>
            <dd><span>{row.value}</span></dd>
            <Button
              className="transfer-copy"
              variant="text"
              type="button"
              aria-label={`Copiar ${row.label.toLocaleLowerCase("es-EC")}`}
              onClick={() => void copy(row.label, row.value)}
            >
              {copied === row.label ? <MaterialSymbol name="check" aria-hidden="true" size={14} /> : <MaterialSymbol name="content_copy" aria-hidden="true" size={14} />}
              <span>{copied === row.label ? "Copiado" : "Copiar"}</span>
            </Button>
          </div>
        ))}
      </dl>
      <p className="visually-hidden" aria-live="polite" role="status">
        {copied ? `Copiaste ${copied.toLocaleLowerCase("es-EC")}.` : copyError ? `No pudimos copiar ${copyError.toLocaleLowerCase("es-EC")}. Selecciona el dato para copiarlo manualmente.` : ""}
      </p>
    </div>
  );
}
