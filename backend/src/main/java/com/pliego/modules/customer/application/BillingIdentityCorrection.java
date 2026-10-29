package com.pliego.modules.customer.application;

import java.time.OffsetDateTime;

/** Customer-safe projection of a correction request; never contains its current-identity snapshot or note. */
public record BillingIdentityCorrection(String id, String status, String proposedType, String proposedNumber,
        String reasonCode, OffsetDateTime createdAt, OffsetDateTime dueAt, OffsetDateTime decidedAt,
        String decisionReason) {
    @Override public String toString() { return "BillingIdentityCorrection[id=" + id + ", status=" + status + ", redacted]"; }
}
