package com.pliego.modules.customer.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "CustomerAddress")
public record CustomerAddressResponse(
        @Schema(example = "15") String addressId,
        @Schema(example = "Casa") String alias,
        @Schema(example = "Ana Pérez") String recipient,
        @Schema(example = "Av. Principal 123") String line1,
        @Schema(example = "Departamento 4", nullable = true) String line2,
        @Schema(example = "Quito") String city,
        @Schema(example = "Pichincha") String province,
        @Schema(example = "EC") String countryCode,
        @Schema(example = "170101", nullable = true) String postalCode,
        @Schema(example = "Frente al parque", nullable = true) String reference,
        @Schema(example = "+59325550134") String phone,
        @Schema(example = "true") boolean primary) {
}
