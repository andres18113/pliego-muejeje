package com.pliego.modules.cart.api;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** REST representations for customer cart reads and mutations. */
public final class CartResponses {

    private CartResponses() { }

    public record Cart(@Schema(nullable = true) String cartId, @Schema(nullable = true) String state,
            List<Item> items, String totalCurrent) { }

    @Schema(name = "CartItem")
    public record Item(String cartItemId, String editionId, String title, String authors, String sku,
            @Schema(nullable = true) String coverUrl,
            int quantity, String currentPrice, String currentSubtotal,
            boolean available,
            @Schema(nullable = true, allowableValues = {"P2043", "P2042", "P3002"}, example = "P3002",
                    description = "SQLSTATE canónico de la condición que impide comprar el artículo: P2043 libro inactivo, "
                            + "P2042 edición inactiva, P3002 existencias insuficientes; null si está disponible.")
            String unavailabilityReason) { }

    public record ItemMutation(String cartId, String cartItemId, int quantity) { }
}
