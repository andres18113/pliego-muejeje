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
            String estimatedDeliveryTo,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean requiresPhysicalFulfillment,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int physicalItemCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int digitalItemCount,
            @Schema(example = "80.00", description = "Subtotal original del carrito antes de ofertas e impuestos, calculado por PostgreSQL; cadena decimal con dos posiciones.")
            String originalSubtotal,
            @Schema(example = "12.00", description = "Ahorro total por ofertas, calculado por PostgreSQL; cadena decimal con dos posiciones.")
            String savingsTotal,
            @Schema(example = "68.00", description = "Subtotal vigente después de ofertas y antes de impuestos, calculado por PostgreSQL; coincide con subtotal y se expresa como cadena decimal con dos posiciones.")
            String currentSubtotal,
            @Schema(description = "Huella del resumen actual para confirmar cantidades y precios en checkout.") String quoteFingerprint) {
        public Cart(String cartId, String state, List<Item> items, String totalCurrent, String subtotal,
                String taxRate, String taxAmount, String shippingAmount, String total,
                String estimatedDeliveryFrom, String estimatedDeliveryTo, boolean requiresPhysicalFulfillment,
                int physicalItemCount, int digitalItemCount, String originalSubtotal, String savingsTotal, String currentSubtotal) {
            this(cartId,state,items,totalCurrent,subtotal,taxRate,taxAmount,shippingAmount,total,estimatedDeliveryFrom,estimatedDeliveryTo,requiresPhysicalFulfillment,physicalItemCount,digitalItemCount,originalSubtotal,savingsTotal,currentSubtotal,null);
        }
        public Cart(String cartId, String state, List<Item> items, String totalCurrent, String subtotal,
                String taxRate, String taxAmount, String shippingAmount, String total,
                String estimatedDeliveryFrom, String estimatedDeliveryTo,
                boolean requiresPhysicalFulfillment, int physicalItemCount, int digitalItemCount) {
            this(cartId, state, items, totalCurrent, subtotal, taxRate, taxAmount, shippingAmount, total,
                    estimatedDeliveryFrom, estimatedDeliveryTo, requiresPhysicalFulfillment,
                    physicalItemCount, digitalItemCount, null, null, null);
        }
    }

    @Schema(name = "CartItem")
    public record Item(String cartItemId, String editionId, String title, String authors, String sku,
            @Schema(nullable = true) String coverUrl,
            int quantity, String currentPrice, String currentSubtotal,
            boolean available,
            @Schema(nullable = true, allowableValues = {"P2043", "P2042", "P3002", "P4004"}, example = "P3002",
                    description = "SQLSTATE canónico de la condición que impide comprar el artículo: P2043 libro inactivo, "
                            + "P2042 edición inactiva, P3002 existencias insuficientes, P4004 cantidad digital inválida; null si está disponible.")
            String unavailabilityReason,
            @Schema(allowableValues = {"PAPERBACK", "HARDCOVER", "EBOOK", "AUDIOBOOK"}) String format,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean requiresPhysicalFulfillment,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean quantityEditable,
            @Schema(example = "20.00", description = "Precio unitario original antes de ofertas, calculado por PostgreSQL; cadena decimal con dos posiciones.")
            String originalPrice,
            @Schema(example = "3.00", description = "Ahorro unitario vigente, calculado por PostgreSQL; cadena decimal con dos posiciones.")
            String unitSavings,
            @Schema(example = "40.00", description = "Subtotal original de la línea para su cantidad, calculado por PostgreSQL; cadena decimal con dos posiciones.")
            String originalSubtotal,
            @Schema(example = "6.00", description = "Ahorro total de la línea para su cantidad, calculado por PostgreSQL; cadena decimal con dos posiciones.")
            String lineSavings) {
        public Item(String cartItemId, String editionId, String title, String authors, String sku,
                String coverUrl, int quantity, String currentPrice, String currentSubtotal,
                boolean available, String unavailabilityReason, String format,
                boolean requiresPhysicalFulfillment, boolean quantityEditable) {
            this(cartItemId, editionId, title, authors, sku, coverUrl, quantity, currentPrice,
                    currentSubtotal, available, unavailabilityReason, format, requiresPhysicalFulfillment,
                    quantityEditable, null, null, null, null);
        }
    }

    public record ItemMutation(String cartId, String cartItemId, int quantity) { }
}
