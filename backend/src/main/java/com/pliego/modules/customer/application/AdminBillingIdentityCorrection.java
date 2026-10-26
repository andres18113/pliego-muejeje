package com.pliego.modules.customer.application;

import java.time.OffsetDateTime;

/** Full request snapshot for an ADMIN correction queue. */
public record AdminBillingIdentityCorrection(String id, String customerId, String customerName,
        String customerEmail, String currentType, String currentNumber, String proposedType, String proposedNumber,
        String reasonCode, String note, String status, OffsetDateTime createdAt, OffsetDateTime dueAt,
        OffsetDateTime decidedAt, String decidedBy, String decisionReason) {
    @Override public String toString() { return "AdminBillingIdentityCorrection[id=" + id + ", status=" + status + ", redacted]"; }
}
