package com.pliego.modules.sales.application;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;

/** Administrative order inputs and read models backed by the approved sales Database API. */
public final class AdminOrderModels {

    private AdminOrderModels() { }

    public record Search(String state, OffsetDateTime dateFrom, OffsetDateTime dateTo,
            Long customerId, int page, int pageSize) { }

    public record Page(List<Summary> items, long totalCount) {
        public Page { items = List.copyOf(items); }
    }

    public record Summary(String orderId, String customerId, String customerName,
            Instant createdAt, String orderState, BigDecimal total, String paymentState) { }

    public record Detail(String orderId, String customerId, String customerEmail, String customerName,
            String orderState, BigDecimal subtotal, BigDecimal total, Instant createdAt, Instant updatedAt,
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
            BigDecimal unitPrice, int quantity, BigDecimal subtotal) { }

    public record Address(String recipient, String line1, String line2, String city,
            String province, String countryCode, String postalCode, String reference, String phone) { }

    public record Payment(String paymentId, String method, String state, BigDecimal amount,
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
