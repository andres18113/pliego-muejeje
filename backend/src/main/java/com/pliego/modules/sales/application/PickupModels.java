package com.pliego.modules.sales.application;

import java.math.BigDecimal;
import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;

/** Administrative pickup projections; customer credentials never enter these values. */
public final class PickupModels {
    private PickupModels() { }

    public record Search(String state, String q, int page, int pageSize) { }
    public record Page(List<View> items, long totalCount) {
        public Page { items = List.copyOf(items); }
    }
    public record View(String orderId, String orderReference, String state, String orderState,
            String paymentState, String createdAt, String readyAt, String collectedAt,
            CollectedBy collectedBy, Boolean identityVerified, Location location, Customer customer,
            List<Item> items, long unitCount, BigDecimal total) {
        public View { items = List.copyOf(items); }
    }
    public record Detail(String orderId, String orderReference, String state, String orderState,
            String paymentState, String createdAt, String readyAt, String collectedAt,
            CollectedBy collectedBy, Boolean identityVerified, Location location, Customer customer,
            List<Item> items, long unitCount, BigDecimal total, String paymentMethod, AvailableActions availableActions) {
        public Detail { items = List.copyOf(items); }
    }
    @Schema(name = "AdminPickupAvailableActions")
    public record AvailableActions(boolean cancel, @Schema(nullable = true, types = {"string", "null"}) String cancellationDeadline) { }
    @Schema(name = "AdminPickupCollectedBy")
    public record CollectedBy(String userId, String email) { }
    @Schema(name = "AdminPickupLocation")
    public record Location(String id, String name, String address, String city) { }
    @Schema(name = "AdminPickupCustomer")
    public record Customer(String customerId, String name, String email,
            @Schema(nullable = true, types = {"string", "null"}) String identityType,
            @Schema(nullable = true, types = {"string", "null"}) String identityNumber) { }
    @Schema(name = "AdminPickupItem")
    public record Item(String orderItemId, String title, String format, int quantity) { }
}
