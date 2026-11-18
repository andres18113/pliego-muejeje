package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "CustomerProfile")
public record CustomerProfileResponse(
        @Schema(example = "87") String customerId,
        @Schema(example = "usuario@example.com") String email,
        @Schema(example = "Ana María") String firstNames,
        @Schema(example = "Pérez López") String lastNames,
        @Schema(example = "+59325550134", nullable = true) String phone,
        @Schema(example = "ACTIVE", allowableValues = { "ACTIVE", "BLOCKED" }) String state,
        @Schema(example = "0", description = "Versión decimal para actualizaciones condicionales.") String version,
        @Schema(description = "Indica si el correo actual está verificado.", example = "true") boolean emailVerified,
        EmailDeliveryResponse emailDelivery,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                description = "Cambio de correo vigente; null cuando no existe o venció.") PendingEmailResponse pendingEmail) {
    @Schema(name = "PendingEmail")
    public record PendingEmailResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String address,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) java.time.Instant expiresAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"OK", "UNDELIVERABLE"}) String delivery) {}
    public record EmailDeliveryResponse(
            @Schema(allowableValues = {"OK", "UNDELIVERABLE"}, description = "Ausencia o presencia de un fallo permanente conocido; no garantiza entrega.") String status,
            @Schema(nullable = true, description = "Fecha del fallo conocido; nula cuando el estado es OK.") java.time.Instant since) {}
}
