# API amendment v1.0.14 — Authoritative monetary projection

V041 implements the requested Ecuador IVA configuration for new purchases. REST cart, checkout, attempt resolution and customer/admin order detail expose authoritative decimal strings:

```json
{"subtotal":"7.25","taxRate":"15.00","taxAmount":"1.09","shippingAmount":"0.00","total":"8.34"}
```

taxRate is percent15.00 (not0.15); prices are net. PostgreSQL rounds each line's subtotal*rate/100 to two decimals, sums taxes and computes total=subtotal+taxAmount+shippingAmount. The frontend must display these values and must not calculate IVA. Cart totalCurrent is retained as an alias of authoritative total. Legacy SQL fn_cart_get retains its earlier signature; Java reads fn_cart_quote. Empty cart has monetary zeros and configured taxRate.

Shipping is0.00 for both modes because there is no shipping tariff model. Orders, line taxes, payment, immutable command receipt, email, invoice header/items and full credit note all use persisted purchase snapshots. Invoice adds taxRate/shippingAmount and keeps taxTotal. Orders before V041 keep original total and zero tax/shipping; invoices issued later from those orders use historical zero-tax snapshots. Later catalog price/tax-policy changes do not reprice purchases/replays/documents.

[ADR0022](../adr/0022-authoritative-ecuador-monetary-projections.md) records schema/routines and cent-rounding regression coverage. No frontend source or generated snapshot changed; backend OpenAPI reflects the expanded records.
