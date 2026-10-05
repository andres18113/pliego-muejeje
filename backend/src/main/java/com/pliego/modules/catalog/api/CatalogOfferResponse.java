package com.pliego.modules.catalog.api;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "CatalogOfferResponse", description = "Oferta activa calculada por el servidor; price es el precio vigente de la edición.")
public record CatalogOfferResponse(String offerId, String originalPrice, String discountAmount,
        String startsAt, String endsAt, int daysRemaining, boolean endingSoon, @Schema(nullable = true) String offerCopy, @Schema(nullable = true) String terms, String effectivePrice, String savingsAmount, String savingsPercent) { }
