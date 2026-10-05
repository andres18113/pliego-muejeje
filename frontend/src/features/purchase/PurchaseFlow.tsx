import type { ReactNode } from "react";
import classes from "./purchaseFlow.module.css";

export type PurchaseStage = "cart" | "checkout" | "confirmation";

/**
 * The purchase family: cart, checkout and confirmation. The focused purchase header says where the customer
 * is; each stage composes its own body, and `PurchaseLayout` + `PurchaseSummary` keep the summary sheet in the
 * same place with the stage's final action inside it.
 */
export function PurchaseFlow({ stage, children }: { stage: PurchaseStage; children: ReactNode }) {
  return <div className={classes.flow} data-storefront-surface data-purchase-stage={stage}>{children}</div>;
}

export function PurchaseLayout({ children, summary }: { children: ReactNode; summary: ReactNode }) {
  return (
    <div className={classes.layout}>
      <div className={classes.main}>{children}</div>
      {summary}
    </div>
  );
}

export interface SummaryLine { key: string; title: string; meta: string; amount: string; extra?: ReactNode }

/** The stable sheet of the flow: what is being bought, the total, and the stage's final action together. */
export function PurchaseSummary({ headingId, title, lines, totals, children }: {
  headingId: string;
  title: ReactNode;
  lines?: SummaryLine[];
  totals: { label: string; value: ReactNode; total?: boolean }[];
  children?: ReactNode;
}) {
  return (
    <aside className={classes.summary} aria-labelledby={headingId} data-purchase="summary">
      <h2 id={headingId}>{title}</h2>
      {lines && lines.length > 0 && (
        <ul className={classes.summaryLines} data-purchase="summary-lines">
          {lines.map((line) => (
            <li key={line.key}>
              <span className={classes.summaryLineTitle}>{line.title}</span>
              <span className={classes.summaryLineMeta}>{line.meta}</span>
              <span className={classes.summaryLineAmount}>{line.amount}</span>
              {line.extra}
            </li>
          ))}
        </ul>
      )}
      <dl className={classes.totals}>
        {totals.map((row) => (
          <div key={row.label} className={row.total ? classes.grandTotal : undefined} data-purchase={row.total ? "total" : undefined}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {children && <div className={classes.summaryAction}>{children}</div>}
    </aside>
  );
}
