package com.pliego.modules.cart.api;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** REST representations for customer cart reads and mutations. */
public final class CartResponses {

    private CartResponses() { }

    public record Cart(@Schema(nullable = true) String cartId, @Schema(nullable = true) String state,
            List<Item> items, String totalCurrent, String subtotal, String taxRate, String taxAmount,
            String shippingAmount, String total,
            @Schema(nullable = true, format = "date", example = "2026-10-05",
                    description = "Primer día de la ventana de entrega a domicilio en el calendario de Ecuador (America/Guayaquil); null si el carrito no incluye libros físicos.")
            String estimatedDeliveryFrom,
            @Schema(nullable = true, format = "date", example = "2026-10-07",
                    description = "Último día de la ventana de entrega a domicilio: dos días después del primero; null si el carrito no incluye libros físicos.")
            String estimatedDeliveryTo) { }

    @Schema(name = "CartItem")
    public record Item(String cartItemId, String editionId, String title, String authors, String sku,
            @Schema(nullable = true) String coverUrl,
            int quantity, String currentPrice, String currentSubtotal,
            boolean available,
            @Schema(nullable = true, allowableValues = {"P2043", "P2042", "P3002", "P4004"}, example = "P3002",
                    description = "SQLSTATE canónico de la condición que impide comprar el artículo: P2043 libro inactivo, "
                            + "P2042 edición inactiva, P3002 existencias insuficientes, P4004 cantidad digital inválida; null si está disponible.")
            String unavailabilityReason,
            @Schema(allowableValues = {"PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"}) String format) { }

    public record ItemMutation(String cartId, String cartItemId, int quantity) { }
}
