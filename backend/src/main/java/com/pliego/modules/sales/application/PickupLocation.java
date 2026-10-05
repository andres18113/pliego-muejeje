package com.pliego.modules.sales.application;

import java.math.BigDecimal;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description="Punto de retiro con dirección y coordenadas estándar, independiente del proveedor de mapas.")
public record PickupLocation(String id, String name, String address, String city, String province,
        String countryCode, String postalCode, BigDecimal latitude, BigDecimal longitude,
        String timezone, OpeningHours openingHours, boolean active, int preparationMinutes) {
    public record OpeningHours(String opensAt, String closesAt) { }
}
