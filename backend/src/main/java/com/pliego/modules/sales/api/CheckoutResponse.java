package com.pliego.modules.sales.api;

import io.swagger.v3.oas.annotations.media.Schema;

public record CheckoutResponse(String orderId, String orderState, String paymentState, String total,
        String paymentReference, com.pliego.modules.sales.application.PostPurchaseModels.Fulfillment fulfillment,
        String subtotal, String taxRate, String taxAmount, String shippingAmount,
        @Schema(nullable = true, example = "50.00", description = "Subtotal original guardado al comprar; null si el pedido histórico no tiene el snapshot de precios.")
        String originalSubtotal,
        @Schema(nullable = true, example = "10.00", description = "Ahorro guardado al comprar, calculado por PostgreSQL; null si falta el snapshot histórico.")
        String savingsTotal,
        @Schema(nullable = true, example = "40.00", description = "Subtotal pagado antes de impuestos, leído del pedido inmutable; cadena decimal con dos posiciones.")
        String currentSubtotal,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Indica si todas las líneas conservan el snapshot de precios originales y ahorros de la compra.")
        boolean pricingSnapshotAvailable) {
    public CheckoutResponse(String orderId, String orderState, String paymentState, String total,
            String paymentReference, com.pliego.modules.sales.application.PostPurchaseModels.Fulfillment fulfillment,
            String subtotal, String taxRate, String taxAmount, String shippingAmount) {
        this(orderId, orderState, paymentState, total, paymentReference, fulfillment,
                subtotal, taxRate, taxAmount, shippingAmount, null, null, null, false);
    }
}
