package com.pliego.modules.sales.application;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;

/** Typed relational post-purchase projections and administrative commands. See ADR-0017. */
public final class PostPurchaseModels {
    private PostPurchaseModels() { }

    /** Historical amounts read exclusively from immutable order snapshots. */
    public record OfferPricing(BigDecimal originalSubtotal, BigDecimal savingsTotal,
            BigDecimal currentSubtotal, boolean pricingSnapshotAvailable) {
        public static OfferPricing unavailable() { return new OfferPricing(null, null, null, false); }
    }

    public record Extras(String purchaseState, Fulfillment fulfillment, Shipment shipment,
            Invoice invoice, List<CreditNote> creditNotes, Actions availableActions,
            com.pliego.foundation.money.MonetaryAmounts amounts, OfferPricing offerPricing) {
        public Extras { creditNotes = List.copyOf(creditNotes); }
        public Extras(String purchaseState, Fulfillment fulfillment, Shipment shipment,
                Invoice invoice, List<CreditNote> creditNotes, Actions availableActions,
                com.pliego.foundation.money.MonetaryAmounts amounts) {
            this(purchaseState, fulfillment, shipment, invoice, creditNotes, availableActions, amounts,
                    OfferPricing.unavailable());
        }
    }
    public record SummaryExtras(String purchaseState, String fulfillmentMethod, String shipmentState,
            String estimatedDeliveryFrom, String estimatedDeliveryTo, long itemCount, long unitCount,
            List<ItemSummary> itemSummary, String invoiceState, boolean invoicePdfAvailable, boolean invoiceXmlAvailable,
            OfferPricing offerPricing, com.pliego.foundation.money.MonetaryAmounts amounts) {
        public SummaryExtras { itemSummary = List.copyOf(itemSummary); }
        public SummaryExtras(String purchaseState, String fulfillmentMethod, String shipmentState,
                String estimatedDeliveryFrom, String estimatedDeliveryTo, long itemCount, long unitCount,
                List<ItemSummary> itemSummary, String invoiceState, boolean invoicePdfAvailable, boolean invoiceXmlAvailable,
                OfferPricing offerPricing) {
            this(purchaseState, fulfillmentMethod, shipmentState, estimatedDeliveryFrom, estimatedDeliveryTo,
                    itemCount, unitCount, itemSummary, invoiceState, invoicePdfAvailable, invoiceXmlAvailable,
                    offerPricing, null);
        }
        public SummaryExtras(String purchaseState, String fulfillmentMethod, String shipmentState,
                String estimatedDeliveryFrom, String estimatedDeliveryTo, long itemCount, long unitCount,
                List<ItemSummary> itemSummary, String invoiceState, boolean invoicePdfAvailable, boolean invoiceXmlAvailable) {
            this(purchaseState, fulfillmentMethod, shipmentState, estimatedDeliveryFrom, estimatedDeliveryTo,
                    itemCount, unitCount, itemSummary, invoiceState, invoicePdfAvailable, invoiceXmlAvailable,
                    OfferPricing.unavailable());
        }
    }
    public record ItemSummary(String orderItemId, String title, String format, int quantity) { }
    public record Pickup(PickupLocation location, String estimatedAt, String readyAt, int preparationMinutes, String pickupCode) { }
    public record Fulfillment(String method, Pickup pickup, String state, String collectedAt) {
        public Fulfillment(String method) { this(method,null,null,null); }
    }
    public record Actions(boolean cancel, boolean changeShippingAddress, boolean canCancel,
            @Schema(nullable = true, description = "Fecha límite, en UTC, para cancelar pedidos digitales y de retiro en tienda.")
            String cancellationDeadline, String lifecycleState, String libraryAccessState) {
        public Actions(boolean cancel, boolean changeShippingAddress) {
            this(cancel, changeShippingAddress, cancel, null, null, null);
        }
    }
    public record Shipment(String shipmentId, String state, String carrier, String trackingCode, String trackingUrl,
            String estimatedDeliveryFrom, String estimatedDeliveryTo, String createdAt, String preparingAt,
            String shippedAt, String outForDeliveryAt, String deliveredAt, String canceledAt, List<ShipmentEvent> history) {
        public Shipment { history = List.copyOf(history); }
    }
    public record ShipmentEvent(String eventId, String type, String origin, String actorUserId,
            String previousState, String newState, String carrier, String trackingCode, String trackingUrl, String at) { }
    public record CheckoutBilling(String recipientKind, String identityType, String identityNumber,
            String buyerName, BillingAddressInput address) {
        public CheckoutBilling(String identityType, String identityNumber, String buyerName, BillingAddressInput address) {
            this("ACCOUNT", identityType, identityNumber, buyerName, address);
        }
        @Override public String toString() { return "CheckoutBilling[redacted]"; }
    }
    public record BillingAddressInput(String line1, String line2, Long provinceId, Long cityId,
            String city, String province, String countryCode, String postalCode) {
        public BillingAddressInput(String line1, String line2, long provinceId, long cityId,
                String countryCode, String postalCode) {
            this(line1,line2,provinceId,cityId,null,null,countryCode,postalCode);
        }
    }
    public record BillingAddressSnapshot(String line1, String line2, String city, String province,
            String countryCode, String postalCode) { }
    public record Invoice(String invoiceId, String documentNumber, String state, String buyerName,
            String identityType, String identityNumber, String buyerEmail, String currency,
            BigDecimal subtotal, BigDecimal taxTotal, BigDecimal total, String issuedAt, BillingAddressSnapshot billingAddress,
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
            String buyerEmail, BillingAddressInput billingAddress) { }
}
