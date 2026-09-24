package com.pliego.modules.cart.api;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** Request DTOs for customer cart commands. */
public final class CartRequests {

    private CartRequests() { }

    public record AddItem(
            @NotNull(message = "La edición es obligatoria.")
            @Pattern(regexp = "^[1-9][0-9]{0,18}$", message = "La edición debe ser un identificador decimal positivo.")
            @DecimalMax(value = "9223372036854775807", message = "La edición debe ser un identificador decimal positivo.")
            String editionId,
            @NotNull(message = "La cantidad es obligatoria.") Integer quantity) { }

    public record Quantity(@NotNull(message = "La cantidad es obligatoria.") Integer quantity) { }
}
