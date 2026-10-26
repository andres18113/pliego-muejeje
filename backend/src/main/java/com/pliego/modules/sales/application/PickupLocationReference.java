package com.pliego.modules.sales.application;

import java.math.BigDecimal;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name="PickupLocationReference",description="Punto de retiro activo con sus IDs de catálogo geográfico.")
public record PickupLocationReference(String id, String name, String address, String city, String province,
        @Schema(example="17",nullable=true) String provinceId,
        @Schema(example="893",nullable=true) String cityId,
        @Schema(example="false") boolean cityNeedsReview, String countryCode, String postalCode,
        BigDecimal latitude, BigDecimal longitude, String timezone, PickupLocation.OpeningHours openingHours,
        boolean active, int preparationMinutes) { }
