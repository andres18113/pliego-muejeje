package com.pliego.modules.catalog.api;

import java.time.OffsetDateTime;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import io.swagger.v3.oas.annotations.media.Schema;

public record EditionOfferRequest(
        @NotNull(message = "El precio de oferta es obligatorio.")
        @Pattern(regexp = "(?:0\\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,8}\\.[0-9]{2})", message = "El precio de oferta debe ser positivo y tener dos posiciones decimales.")
        @Schema(example = "15.00") String offerPrice,
        @NotNull(message = "La fecha de inicio es obligatoria.") OffsetDateTime startsAt,
        @NotNull(message = "La fecha de finalización es obligatoria.") OffsetDateTime endsAt,
        @jakarta.validation.constraints.Size(max = 1000, message = "El texto de la oferta no puede superar 1000 caracteres.") String offerCopy,
        @jakarta.validation.constraints.Size(max = 5000, message = "Las condiciones no pueden superar 5000 caracteres.") String terms) { }
