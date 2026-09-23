package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "CustomerProfile")
public record CustomerProfileResponse(
        @Schema(example = "87") String customerId,
        @Schema(example = "usuario@example.com") String email,
        @Schema(example = "Ana María") String firstNames,
        @Schema(example = "Pérez López") String lastNames,
        @Schema(example = "+59325550134", nullable = true) String phone,
        @Schema(example = "ACTIVE", allowableValues = { "ACTIVE", "BLOCKED" }) String state) {
}
