package com.pliego.modules.customer.api;

import java.time.Instant;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "EmailChangeResponse", description = "Correo vigente y cambio pendiente de confirmación.")
public record EmailChangeResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = "actual@example.com") String email,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) PendingAddress pendingEmail) {
    @Schema(name = "RequestedPendingEmail")
    public record PendingAddress(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = "nuevo@example.com") String address,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {}
}
