package com.pliego.modules.sales.api;

import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import io.swagger.v3.oas.annotations.media.Schema;

/** Explicit administrative input; invoice amounts and purchased lines are server-owned. */
public final class PostPurchaseRequests {
    private PostPurchaseRequests() { }
    public record ShipmentTransition(
            @NotBlank(message="El estado del envío es obligatorio.")
            @Pattern(regexp="PREPARING|SHIPPED|OUT_FOR_DELIVERY|DELIVERED",message="El estado del envío no es válido.") String targetState) { }
    public record Tracking(
            @Size(max=120,message="El transportista no puede superar 120 caracteres.") String carrier,
            @Size(max=120,message="El código de seguimiento no puede superar 120 caracteres.") String trackingCode,
            @Size(max=1000,message="La dirección de seguimiento no puede superar 1000 caracteres.")
            @Pattern(regexp="https://[^\\s]+",message="La dirección de seguimiento debe usar HTTPS.") String trackingUrl,
            OffsetDateTime estimatedDeliveryFrom,OffsetDateTime estimatedDeliveryTo) { }
    @Schema(name="InvoiceBillingAddressRequest")
    public record BillingAddress(
            @NotBlank(message="La dirección de cobro es obligatoria.") @Size(max=200,message="La dirección no puede superar 200 caracteres.") String line1,
            @Size(max=200,message="La dirección adicional no puede superar 200 caracteres.") String line2,
            @NotBlank(message="La ciudad es obligatoria.") @Size(max=100,message="La ciudad no puede superar 100 caracteres.") String city,
            @NotBlank(message="La provincia es obligatoria.") @Size(max=100,message="La provincia no puede superar 100 caracteres.") String province,
            @NotBlank(message="El país es obligatorio.") @Pattern(regexp="[A-Za-z]{2}",message="El país debe tener un código de dos letras.") String countryCode,
            @Size(max=20,message="El código postal no puede superar 20 caracteres.") String postalCode) { }
    @Schema(name="IssueOrderInvoiceRequest")
    public record Invoice(
            @NotBlank(message="El número de documento es obligatorio.") @Size(max=80,message="El número no puede superar 80 caracteres.") String documentNumber,
            @NotBlank(message="El nombre del comprador es obligatorio.") @Size(max=240,message="El nombre no puede superar 240 caracteres.") String buyerName,
            @NotBlank(message="El tipo de identificación es obligatorio.")
            @Pattern(regexp="NATIONAL_ID|TAX_ID|PASSPORT|OTHER",message="El tipo de identificación no es válido.") String identityType,
            @NotBlank(message="La identificación del comprador es obligatoria.") @Size(max=80,message="La identificación no puede superar 80 caracteres.") String identityNumber,
            @Email(message="El correo del comprador no es válido.") @Size(max=254,message="El correo no puede superar 254 caracteres.") String buyerEmail,
            @NotNull(message="La dirección de cobro es obligatoria.") @Valid BillingAddress billingAddress) { }
    @Schema(name="IssueOrderCreditNoteRequest")
    public record CreditNote(
            @NotBlank(message="El número de documento es obligatorio.") @Size(max=80,message="El número no puede superar 80 caracteres.") String documentNumber,
            @NotBlank(message="El motivo es obligatorio.") @Size(max=500,message="El motivo no puede superar 500 caracteres.") String reason) { }
}
