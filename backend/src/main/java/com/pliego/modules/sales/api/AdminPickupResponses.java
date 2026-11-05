package com.pliego.modules.sales.api;

import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.util.List;

import com.pliego.modules.sales.application.PickupModels;
import io.swagger.v3.oas.annotations.media.Schema;

public final class AdminPickupResponses {
    private AdminPickupResponses() { }

    @Schema(name = "PickupView", description = "Retiro administrativo sin código de retiro.")
    public record PickupView(String orderId, String orderReference,
            @Schema(allowableValues = {"PENDING", "READY", "COLLECTED", "CANCELLED"}) String state,
            String orderState, String paymentState, String createdAt, @Schema(nullable = true) String readyAt,
            @Schema(nullable = true) String collectedAt, @Schema(nullable = true, schemaResolution = Schema.SchemaResolution.INLINE,
                    types = {"object", "null"}) PickupModels.CollectedBy collectedBy,
            @Schema(nullable = true) Boolean identityVerified, PickupModels.Location location, PickupModels.Customer customer,
            List<PickupModels.Item> items, long unitCount, String total) { }

    @Schema(name = "AdminPickupDetail", description = "Detalle de retiro sin código, con acciones permitidas por la base de datos.")
    public record AdminPickupDetail(String orderId, String orderReference,
            @Schema(allowableValues = {"PENDING", "READY", "COLLECTED", "CANCELLED"}) String state,
            String orderState, String paymentState, String createdAt, @Schema(nullable = true) String readyAt,
            @Schema(nullable = true) String collectedAt, @Schema(nullable = true, schemaResolution = Schema.SchemaResolution.INLINE,
                    types = {"object", "null"}) PickupModels.CollectedBy collectedBy,
            @Schema(nullable = true) Boolean identityVerified, PickupModels.Location location, PickupModels.Customer customer,
            List<PickupModels.Item> items, long unitCount, String total,
            @Schema(nullable = true, types = {"string", "null"}) String paymentMethod, PickupModels.AvailableActions availableActions) { }

    static AdminPickupDetail detail(PickupModels.Detail value) {
        var actions = value.availableActions();
        return new AdminPickupDetail(value.orderId(), value.orderReference(), value.state(), value.orderState(),
                value.paymentState(), utc(value.createdAt()), utc(value.readyAt()), utc(value.collectedAt()),
                value.collectedBy(), value.identityVerified(), value.location(), value.customer(), value.items(),
                value.unitCount(), value.total().setScale(2, RoundingMode.UNNECESSARY).toPlainString(),
                value.paymentMethod(), new PickupModels.AvailableActions(actions.cancel(), utc(actions.cancellationDeadline())));
    }

    static PickupView view(PickupModels.View value) {
        return new PickupView(value.orderId(), value.orderReference(), value.state(), value.orderState(),
                value.paymentState(), utc(value.createdAt()), utc(value.readyAt()), utc(value.collectedAt()),
                value.collectedBy(), value.identityVerified(), value.location(), value.customer(), value.items(),
                value.unitCount(), value.total().setScale(2, RoundingMode.UNNECESSARY).toPlainString());
    }

    private static String utc(String value) {
        return value == null ? null : OffsetDateTime.parse(value).toInstant().toString();
    }
}
