package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public final class AdminBillingIdentityCorrectionRequests {
    private AdminBillingIdentityCorrectionRequests() { }

    public record Decision(
            @NotBlank(message = "Selecciona una decisión.")
            @Pattern(regexp = "APPROVE|REJECT", message = "La decisión debe ser APPROVE o REJECT.") String decision,
            @Schema(description = "Obligatorio al rechazar; se muestra al cliente en español.") String decisionReason) {
        public Decision { decisionReason = decisionReason == null ? null : decisionReason.trim(); }

        @AssertTrue(message = "Escribe en español el motivo del rechazo.")
        @com.fasterxml.jackson.annotation.JsonIgnore
        public boolean isRejectReasonValid() {
            return !"REJECT".equals(decision) || (decisionReason != null && !decisionReason.isBlank());
        }
    }
}
