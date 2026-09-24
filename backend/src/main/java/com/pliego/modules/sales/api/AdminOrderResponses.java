package com.pliego.modules.sales.api;

import java.util.List;

/** Administrative order wire models; all identifiers and monetary values are JSON strings. */
public final class AdminOrderResponses {
    private AdminOrderResponses() { }

    public record Summary(String orderId, String customerId, String customerName,
            String createdAt, String orderState, String total, String paymentState) { }

    public record Detail(String orderId, String customerId, String customerEmail, String customerName,
            String orderState, String subtotal, String total, String createdAt, String updatedAt,
            List<Item> items, Address address, Payment payment, List<History> stateHistory,
            List<InventoryMovement> inventoryMovements) {
        public Detail {
            items = List.copyOf(items);
            stateHistory = List.copyOf(stateHistory);
            inventoryMovements = List.copyOf(inventoryMovements);
        }
    }

    public record Item(String orderItemId, String editionId, String sku, String isbn,
            String title, String authors, String publisher, String format, String language,
            String unitPrice, int quantity, String subtotal) { }

    public record Address(String recipient, String line1, String line2, String city,
            String province, String countryCode, String postalCode, String reference, String phone) { }

    public record Payment(String paymentId, String method, String state, String amount,
            String reference, String resultDetail, String createdAt, String updatedAt) { }

    public record History(String historyId, String actorUserId, String origin,
            String previousState, String newState, String at) { }

    public record InventoryMovement(String movementId, String editionId, String orderId,
            String actorUserId, String type, int quantity, int stockBefore, int stockAfter,
            String reason, String eventAt) { }

    public record Transition(String orderId, String previousState, String orderState) { }

    public record Cancellation(String orderId, String previousState, String orderState,
            String paymentState, long restoredUnits) { }
}
