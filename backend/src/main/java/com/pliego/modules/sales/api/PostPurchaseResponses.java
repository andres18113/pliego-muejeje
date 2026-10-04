package com.pliego.modules.sales.api;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import com.pliego.modules.sales.application.PostPurchaseModels;
import io.swagger.v3.oas.annotations.media.Schema;

/** Invoice wire contracts: exact decimal strings, typed snapshots and provider-neutral processing. */
public final class PostPurchaseResponses {
    private PostPurchaseResponses() { }

    @Schema(name="OrderInvoice")
    public record Invoice(String invoiceId, String documentNumber, String state, String buyerName,
            String identityType, String identityNumber, String buyerEmail, String currency,
            String subtotal, String taxTotal, String total, String issuedAt,
            PostPurchaseModels.BillingAddress billingAddress, List<InvoiceItem> items,
            PostPurchaseModels.ElectronicIssuance electronicIssuance, boolean pdfAvailable, boolean xmlAvailable) { }
    @Schema(name="OrderInvoiceItem")
    public record InvoiceItem(String invoiceItemId, String orderItemId, String description, int quantity,
            String unitPrice, String subtotal, String taxTreatment, String taxRate, String taxAmount, String total) { }
    @Schema(name="OrderCreditNote")
    public record CreditNote(String creditNoteId, String invoiceId, String documentNumber, String state,
            String reason, String subtotal, String taxTotal, String total, String issuedAt) { }
    public record ShipmentResult(String orderId, PostPurchaseModels.Shipment shipment) { }
    public record IssuedInvoice(String orderId, String invoiceId) { }
    public record IssuedCreditNote(String orderId, String creditNoteId) { }

    static Invoice invoice(PostPurchaseModels.Invoice value) {
        if (value==null) return null;
        return new Invoice(value.invoiceId(),value.documentNumber(),value.state(),value.buyerName(),
                value.identityType(),value.identityNumber(),value.buyerEmail(),value.currency(),
                money(value.subtotal()),money(value.taxTotal()),money(value.total()),value.issuedAt(),value.billingAddress(),
                value.items().stream().map(i->new InvoiceItem(i.invoiceItemId(),i.orderItemId(),i.description(),i.quantity(),
                    money(i.unitPrice()),money(i.subtotal()),i.taxTreatment(),i.taxRate()==null?null:i.taxRate().toPlainString(),
                    money(i.taxAmount()),money(i.total()))).toList(),value.electronicIssuance(),value.pdfAvailable(),value.xmlAvailable());
    }
    static List<CreditNote> creditNotes(List<PostPurchaseModels.CreditNote> values) {
        return values.stream().map(n->new CreditNote(n.creditNoteId(),n.invoiceId(),n.documentNumber(),n.state(),
                n.reason(),money(n.subtotal()),money(n.taxTotal()),money(n.total()),n.issuedAt())).toList();
    }
    private static String money(BigDecimal value) { return value.setScale(2,RoundingMode.UNNECESSARY).toPlainString(); }
}
