package com.pliego.modules.sales.api;

import java.util.List;
import com.pliego.modules.sales.application.PostPurchaseModels;
import io.swagger.v3.oas.annotations.media.Schema;

/** Customer order representations; identifiers and money are JSON strings. */
public final class CustomerOrderResponses {

    private CustomerOrderResponses() { }

    @Schema(name="CustomerOrderSummary")
    public record Summary(String orderId, String createdAt, String orderState,
            String total, String paymentState, String purchaseState, String fulfillmentMethod,
            String shipmentState, String estimatedDeliveryFrom, String estimatedDeliveryTo,
            long itemCount, long unitCount, List<PostPurchaseModels.ItemSummary> itemSummary,
            String invoiceState, boolean invoicePdfAvailable, boolean invoiceXmlAvailable,
            @Schema(nullable = true, description = "Subtotal original guardado al comprar; null si falta el snapshot histórico.") String originalSubtotal,
            @Schema(nullable = true, description = "Ahorro total guardado al comprar; null si falta el snapshot histórico.") String savingsTotal,
            @Schema(nullable = true, description = "Subtotal pagado antes de impuestos, leído del pedido inmutable; cadena decimal con dos posiciones.") String currentSubtotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Indica si todas las líneas conservan el snapshot de precios originales y ahorros de la compra.") boolean pricingSnapshotAvailable,
            @Schema(nullable = true, description = "Subtotal pagado antes de impuestos, leído del pedido inmutable; cadena decimal con dos posiciones.") String subtotal,
            @Schema(nullable = true, description = "Tasa de impuesto guardada al comprar, expresada como porcentaje y cadena decimal con dos posiciones.") String taxRate,
            @Schema(nullable = true, description = "Importe de impuesto guardado al comprar; cadena decimal con dos posiciones.") String taxAmount,
            @Schema(nullable = true, description = "Importe de envío guardado al comprar; cadena decimal con dos posiciones.") String shippingAmount) {
        public Summary(String orderId, String createdAt, String orderState,
                String total, String paymentState, String purchaseState, String fulfillmentMethod,
                String shipmentState, String estimatedDeliveryFrom, String estimatedDeliveryTo,
                long itemCount, long unitCount, List<PostPurchaseModels.ItemSummary> itemSummary,
                String invoiceState, boolean invoicePdfAvailable, boolean invoiceXmlAvailable,
                String originalSubtotal, String savingsTotal, String currentSubtotal, boolean pricingSnapshotAvailable) {
            this(orderId, createdAt, orderState, total, paymentState, purchaseState, fulfillmentMethod,
                    shipmentState, estimatedDeliveryFrom, estimatedDeliveryTo, itemCount, unitCount,
                    itemSummary, invoiceState, invoicePdfAvailable, invoiceXmlAvailable,
                    originalSubtotal, savingsTotal, currentSubtotal, pricingSnapshotAvailable, null, null, null, null);
        }
        public Summary(String orderId, String createdAt, String orderState,
                String total, String paymentState, String purchaseState, String fulfillmentMethod,
                String shipmentState, String estimatedDeliveryFrom, String estimatedDeliveryTo,
                long itemCount, long unitCount, List<PostPurchaseModels.ItemSummary> itemSummary,
                String invoiceState, boolean invoicePdfAvailable, boolean invoiceXmlAvailable) {
            this(orderId, createdAt, orderState, total, paymentState, purchaseState, fulfillmentMethod,
                    shipmentState, estimatedDeliveryFrom, estimatedDeliveryTo, itemCount, unitCount,
                    itemSummary, invoiceState, invoicePdfAvailable, invoiceXmlAvailable, null, null, null, false);
        }
    }

    @Schema(name="CustomerOrderDetail")
    public record Detail(String orderId, String orderState, String subtotal, String total,
            String createdAt, String updatedAt, List<Item> items, @Schema(nullable=true) Address address,
            Payment payment, List<History> stateHistory, String purchaseState,
            @Schema(nullable=true) PostPurchaseModels.Fulfillment fulfillment, @Schema(nullable=true) PostPurchaseModels.Shipment shipment,
            PostPurchaseResponses.Invoice invoice, List<PostPurchaseResponses.CreditNote> creditNotes,
            PostPurchaseModels.Actions availableActions, String taxRate, String taxAmount, String shippingAmount,
            @Schema(nullable = true, description = "Subtotal original guardado al comprar; null si falta el snapshot histórico.") String originalSubtotal,
            @Schema(nullable = true, description = "Ahorro total guardado al comprar; null si falta el snapshot histórico.") String savingsTotal,
            @Schema(nullable = true, description = "Subtotal pagado antes de impuestos, leído del pedido inmutable; cadena decimal con dos posiciones.") String currentSubtotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Indica si todas las líneas conservan el snapshot de precios originales y ahorros de la compra.") boolean pricingSnapshotAvailable) {
        public Detail(String orderId, String orderState, String subtotal, String total,
                String createdAt, String updatedAt, List<Item> items, Address address,
                Payment payment, List<History> stateHistory, String purchaseState,
                PostPurchaseModels.Fulfillment fulfillment, PostPurchaseModels.Shipment shipment,
                PostPurchaseResponses.Invoice invoice, List<PostPurchaseResponses.CreditNote> creditNotes,
                PostPurchaseModels.Actions availableActions, String taxRate, String taxAmount, String shippingAmount) {
            this(orderId, orderState, subtotal, total, createdAt, updatedAt, items, address, payment,
                    stateHistory, purchaseState, fulfillment, shipment, invoice, creditNotes, availableActions,
                    taxRate, taxAmount, shippingAmount, null, null, null, false);
        }
    }

    @Schema(name="CustomerOrderItem")
    public record Item(String orderItemId, String editionId, String sku, String isbn,
            String title, String authors, String publisher, String format, String language,
            String unitPrice, int quantity, String subtotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean requiresPhysicalFulfillment,
            @Schema(nullable = true, description = "Precio unitario original guardado al comprar; null si falta el snapshot histórico.") String originalPrice,
            @Schema(nullable = true, description = "Ahorro unitario guardado al comprar; null si falta el snapshot histórico.") String unitSavings,
            @Schema(nullable = true, description = "Subtotal original de la línea guardado al comprar; null si falta el snapshot histórico.") String originalSubtotal,
            @Schema(nullable = true, description = "Ahorro total de la línea guardado al comprar; null si falta el snapshot histórico.") String lineSavings,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Indica si esta línea conserva el snapshot de precios originales y ahorros de la compra.") boolean pricingSnapshotAvailable) {
        public Item(String orderItemId, String editionId, String sku, String isbn,
                String title, String authors, String publisher, String format, String language,
                String unitPrice, int quantity, String subtotal, boolean requiresPhysicalFulfillment) {
            this(orderItemId, editionId, sku, isbn, title, authors, publisher, format, language,
                    unitPrice, quantity, subtotal, requiresPhysicalFulfillment, null, null, null, null, false);
        }
    }

    public record Address(String recipient, String line1, String line2, String city,
            String province, String countryCode, String postalCode, String reference, String phone) { }

    public record Payment(String paymentId, String method, String state, String amount,
            String reference, String resultDetail, String createdAt, String updatedAt) { }

    public record History(String historyId, String actorUserId, String origin,
            String previousState, String newState, String at) { }

    public record Cancellation(String orderId, String previousState, String orderState,
            String paymentState, long restoredUnits) { }
}
