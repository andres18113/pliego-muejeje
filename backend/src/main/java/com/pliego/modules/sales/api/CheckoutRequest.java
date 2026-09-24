package com.pliego.modules.sales.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record CheckoutRequest(
        @NotNull(message = "La dirección es obligatoria.")
        @Pattern(regexp = "^[1-9][0-9]{0,18}$", message = "La dirección debe ser un identificador decimal positivo.")
        @DecimalMax(value = "9223372036854775807", message = "La dirección debe ser un identificador decimal positivo.")
        String addressId,
        @NotNull(message = "El método de pago es obligatorio.")
        @Pattern(regexp = "CARD|TRANSFER", message = "El método de pago no es válido.")
        String paymentMethod,
        @NotNull(message = "El resultado de simulación es obligatorio.")
        String simulationOutcome,
        @Schema(accessMode = Schema.AccessMode.WRITE_ONLY,
                description = "Se valida localmente y nunca se persiste ni se envía a PostgreSQL.")
        String cardNumber) {

    @Override
    public String toString() {
        return "CheckoutRequest[addressId=" + addressId + ", paymentMethod=" + paymentMethod
                + ", simulationOutcome=" + simulationOutcome + ", cardNumber=[redacted]]";
    }
}
