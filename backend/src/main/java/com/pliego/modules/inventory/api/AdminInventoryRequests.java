package com.pliego.modules.inventory.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/** Validated request bodies for the approved ADMIN inventory endpoints. */
public final class AdminInventoryRequests {
    private AdminInventoryRequests() { }

    public record Entry(@NotNull(message = "La cantidad es obligatoria.")
            @Positive(message = "La cantidad debe ser mayor que cero.") Integer quantity,
            @NotBlank(message = "El motivo no puede estar vacío.")
            @Size(max = 500, message = "El motivo excede la longitud permitida.") String reason) { }

    public record Adjustment(@NotBlank(message = "El tipo de ajuste es obligatorio.")
            @Pattern(regexp = "ADJUSTMENT_IN|ADJUSTMENT_OUT",
                    message = "El tipo de ajuste debe ser ADJUSTMENT_IN o ADJUSTMENT_OUT.") String type,
            @NotNull(message = "La cantidad es obligatoria.")
            @Positive(message = "La cantidad debe ser mayor que cero.") Integer quantity,
            @NotBlank(message = "El motivo no puede estar vacío.")
            @Size(max = 500, message = "El motivo excede la longitud permitida.") String reason) { }

    public record Minimum(@NotNull(message = "El stock mínimo es obligatorio.")
            @PositiveOrZero(message = "El stock mínimo no puede ser negativo.") Integer stockMinimum) { }
}
