package com.pliego.modules.sales.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** Validated request bodies for the approved administrative order commands. */
public final class AdminOrderRequests {
    private AdminOrderRequests() { }

    public record Transition(@NotBlank(message = "El estado solicitado es obligatorio.")
            @Pattern(regexp = "PREPARING|SHIPPED|DELIVERED",
                    message = "El estado debe ser PREPARING, SHIPPED o DELIVERED.") String targetState) { }
}
