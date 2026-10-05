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
            String invoiceState, boolean invoicePdfAvailable, boolean invoiceXmlAvailable) { }

    @Schema(name="CustomerOrderDetail")
    public record Detail(String orderId, String orderState, String subtotal, String total,
            String createdAt, String updatedAt, List<Item> items, Address address,
            Payment payment, List<History> stateHistory, String purchaseState,
            PostPurchaseModels.Fulfillment fulfillment, PostPurchaseModels.Shipment shipment,
            PostPurchaseResponses.Invoice invoice, List<PostPurchaseResponses.CreditNote> creditNotes,
            PostPurchaseModels.Actions availableActions, String taxRate, String taxAmount, String shippingAmount) { }

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
