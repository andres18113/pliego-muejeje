package com.pliego.modules.customer.application;

import java.time.OffsetDateTime;

/** Own-profile projection. Never include the number in diagnostic output. */
public record BillingIdentity(String type, String number, boolean used, String correctionMode,
        CorrectionRequest correctionRequest) {
    public BillingIdentity(String type, String number) {
        this(type, number, false, "DIRECT", null);
    }

    public record CorrectionRequest(String id, String status, String proposedType, String proposedNumber,
            String reasonCode, OffsetDateTime createdAt, OffsetDateTime dueAt, OffsetDateTime decidedAt,
            String decisionReason) {
        @Override public String toString() { return "CorrectionRequest[id=" + id + ", status=" + status + ", redacted]"; }
    }

    @Override public String toString() { return "BillingIdentity[redacted]"; }
}
