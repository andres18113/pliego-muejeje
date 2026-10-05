package com.pliego.modules.sales.application;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

/** Typed relational post-purchase projections and administrative commands. See ADR-0017. */
public final class PostPurchaseModels {
    private PostPurchaseModels() { }

    public record Extras(String purchaseState, Fulfillment fulfillment, Shipment shipment,
            Invoice invoice, List<CreditNote> creditNotes, Actions availableActions, com.pliego.foundation.money.MonetaryAmounts amounts) {
        public Extras { creditNotes = List.copyOf(creditNotes); }
    }
    public record SummaryExtras(String purchaseState, String fulfillmentMethod, String shipmentState,
            String estimatedDeliveryFrom, String estimatedDeliveryTo, long itemCount, long unitCount,
            List<ItemSummary> itemSummary, String invoiceState, boolean invoicePdfAvailable, boolean invoiceXmlAvailable) {
        public SummaryExtras { itemSummary = List.copyOf(itemSummary); }
    }
    public record ItemSummary(String orderItemId, String title, String format, int quantity) { }
    public record Pickup(PickupLocation location, String estimatedAt, String readyAt, int preparationMinutes, String pickupCode) { }
    public record Fulfillment(String method, Pickup pickup, String state, String collectedAt) {
        public Fulfillment(String method) { this(method,null,null,null); }
    }
    public record Actions(boolean cancel, boolean changeShippingAddress) { }
    public record Shipment(String shipmentId, String state, String carrier, String trackingCode, String trackingUrl,
            String estimatedDeliveryFrom, String estimatedDeliveryTo, String createdAt, String preparingAt,
            String shippedAt, String outForDeliveryAt, String deliveredAt, String canceledAt, List<ShipmentEvent> history) {
        public Shipment { history = List.copyOf(history); }
    }
    public record ShipmentEvent(String eventId, String type, String origin, String actorUserId,
            String previousState, String newState, String carrier, String trackingCode, String trackingUrl, String at) { }
    public record BillingAddress(String line1, String line2, String city, String province, String countryCode, String postalCode) { }
    public record Invoice(String invoiceId, String documentNumber, String state, String buyerName,
            String identityType, String identityNumber, String buyerEmail, String currency,
            BigDecimal subtotal, BigDecimal taxTotal, BigDecimal total, String issuedAt, BillingAddress billingAddress,
            List<InvoiceItem> items, ElectronicIssuance electronicIssuance, boolean pdfAvailable, boolean xmlAvailable,
            BigDecimal taxRate, BigDecimal shippingAmount) {
        public Invoice { items = List.copyOf(items); }
    }
    public record InvoiceItem(String invoiceItemId, String orderItemId, String description, int quantity,
            BigDecimal unitPrice, BigDecimal subtotal, String taxTreatment, BigDecimal taxRate,
            BigDecimal taxAmount, BigDecimal total) { }
    public record ElectronicIssuance(String provider, String state, String externalReference, String submittedAt, String authorizedAt) { }
    public record CreditNote(String creditNoteId, String invoiceId, String documentNumber, String state,
            String reason, BigDecimal subtotal, BigDecimal taxTotal, BigDecimal total, String issuedAt,
            BigDecimal taxRate, BigDecimal shippingAmount) { }
    public record Tracking(String carrier, String trackingCode, String trackingUrl,
            OffsetDateTime estimatedDeliveryFrom, OffsetDateTime estimatedDeliveryTo) { }
    public record IssueInvoice(String documentNumber, String buyerName, String identityType, String identityNumber,
            String buyerEmail, BillingAddress billingAddress) { }
}
