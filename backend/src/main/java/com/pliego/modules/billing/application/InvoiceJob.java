package com.pliego.modules.billing.application;

import java.util.UUID;

/** A leased immutable issuance snapshot. Never log its contents. */
public record InvoiceJob(long invoiceId, String type, UUID owner, int attempt, String snapshot) {
    @Override public String toString() {
        return "InvoiceJob[invoiceId=" + invoiceId + ", type=" + type + ", attempt=" + attempt + "]";
    }
}
