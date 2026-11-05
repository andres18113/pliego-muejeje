package com.pliego.modules.customer.application;

import java.time.OffsetDateTime;

/** Own-profile projection. Never include the number in diagnostic output. */
@io.swagger.v3.oas.annotations.media.Schema(name="StoredBillingIdentity")
public record BillingIdentity(String type, String number, boolean used, String correctionMode,
        @io.swagger.v3.oas.annotations.media.Schema(description="Solicitud pendiente o última solicitud reciente. Una decisión APPROVED/REJECTED reconocida por el cliente se representa como null; no reaparecen decisiones anteriores. PENDING y la recencia histórica de 30 días no cambian.")
        CorrectionRequest correctionRequest) {
    public BillingIdentity(String type, String number) {
        this(type, number, false, "DIRECT", null);
    }

    @io.swagger.v3.oas.annotations.media.Schema(name="StoredBillingIdentityCorrectionRequest")
    public record CorrectionRequest(String id, String status, String proposedType, String proposedNumber,
            String reasonCode, OffsetDateTime createdAt, OffsetDateTime dueAt, OffsetDateTime decidedAt,
            String decisionReason) {
        @Override public String toString() { return "CorrectionRequest[id=" + id + ", status=" + status + ", redacted]"; }
    }

    @Override public String toString() { return "BillingIdentity[redacted]"; }
}
