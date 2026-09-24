package com.pliego.modules.sales.application;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Values returned by the approved customer order Functions and cancellation Procedure. */
public final class OrderModels {

    private OrderModels() { }

    public record Page(List<Summary> items, long totalCount) {
        public Page { items = List.copyOf(items); }
    }

    public record Summary(String orderId, Instant createdAt, String orderState,
            BigDecimal total, String paymentState) { }

    public record Detail(String orderId, String orderState, BigDecimal subtotal, BigDecimal total,
            Instant createdAt, Instant updatedAt, List<Item> items, Address address,
            Payment payment, List<History> stateHistory) {
        public Detail {
            items = List.copyOf(items);
            stateHistory = List.copyOf(stateHistory);
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

    public record Cancellation(String orderId, String previousState, String orderState,
            String paymentState, long restoredUnits) { }
}
