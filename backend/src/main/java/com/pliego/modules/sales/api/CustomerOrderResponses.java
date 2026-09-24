package com.pliego.modules.sales.api;

import java.util.List;

/** Customer order representations; identifiers and money are JSON strings. */
public final class CustomerOrderResponses {

    private CustomerOrderResponses() { }

    public record Summary(String orderId, String createdAt, String orderState,
            String total, String paymentState) { }

    public record Detail(String orderId, String orderState, String subtotal, String total,
            String createdAt, String updatedAt, List<Item> items, Address address,
            Payment payment, List<History> stateHistory) { }

    public record Item(String orderItemId, String editionId, String sku, String isbn,
            String title, String authors, String publisher, String format, String language,
            String unitPrice, int quantity, String subtotal) { }

    public record Address(String recipient, String line1, String line2, String city,
            String province, String countryCode, String postalCode, String reference, String phone) { }

    public record Payment(String paymentId, String method, String state, String amount,
            String reference, String resultDetail, String createdAt, String updatedAt) { }

    public record History(String historyId, String actorUserId, String origin,
            String previousState, String newState, String at) { }

    public record Cancellation(String orderId, String previousState, String orderState,
            String paymentState, long restoredUnits) { }
}
