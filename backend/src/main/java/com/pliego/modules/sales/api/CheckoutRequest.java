package com.pliego.modules.sales.api;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.AssertTrue;

public record CheckoutRequest(
        @Pattern(regexp = "^[1-9][0-9]{0,18}$", message = "La dirección debe ser un identificador decimal positivo.")
        @DecimalMax(value = "9223372036854775807", message = "La dirección debe ser un identificador decimal positivo.")
        String addressId,
        @NotNull(message = "El método de pago es obligatorio.")
        @Pattern(regexp = "CARD|TRANSFER", message = "El método de pago no es válido.")
        String paymentMethod,
        @NotNull(message = "El resultado de simulación es obligatorio.")
        String simulationOutcome,
        @Schema(accessMode = Schema.AccessMode.WRITE_ONLY,
                description = "Se valida localmente y nunca se persiste ni se envía a PostgreSQL.")
        String cardNumber,
        @Pattern(regexp = "^[1-9][0-9]{0,18}$", message = "El carrito debe ser un identificador decimal positivo.")
        @DecimalMax(value = "9223372036854775807", message = "El carrito debe ser un identificador decimal positivo.")
        String expectedCartId,
        @Pattern(regexp = "HOME_DELIVERY|STORE_PICKUP|DIGITAL_ONLY", message = "El método de entrega no es válido.")
        @Schema(defaultValue = "HOME_DELIVERY", allowableValues = {"HOME_DELIVERY", "STORE_PICKUP", "DIGITAL_ONLY"}) String fulfillmentMethod,
        @Pattern(regexp = "^[1-9][0-9]{0,18}$", message = "El punto de retiro debe ser un identificador positivo.")
        @DecimalMax(value = "9223372036854775807", message = "El punto de retiro debe ser un identificador positivo.") String pickupLocationId,
        @Pattern(regexp = "^[0-9a-f]{64}$", message = "El resumen de compra no es válido. Consulta el carrito de nuevo.")
        @Schema(description = "Huella del resumen aceptado devuelta por GET /cart; protege cantidades y precios entre consulta y confirmación.") String expectedQuoteFingerprint,
        @jakarta.validation.Valid BillingIdentity billingIdentity,
        @jakarta.validation.constraints.Size(max = 240, message = "El nombre del comprador no puede superar 240 caracteres.") String buyerName,
        @jakarta.validation.Valid PostPurchaseRequests.BillingAddress billingAddress) {

    public record BillingIdentity(
            @NotNull(message = "Selecciona el tipo de identificación.")
            @Pattern(regexp = "EC_CEDULA", message = "Selecciona cédula ecuatoriana.") String type,
            @com.pliego.foundation.validation.ValidEcuadorianCedula String number) {
        public BillingIdentity { number = com.pliego.foundation.validation.EcuadorianCedula.normalized(number); }
        @Override public String toString() { return "BillingIdentity[redacted]"; }
    }

    @AssertTrue(message = "Confirma la cédula, el nombre y la dirección de facturación completos.")
    @com.fasterxml.jackson.annotation.JsonIgnore
    public boolean isBillingComplete() {
        return billingIdentity == null && buyerName == null && billingAddress == null
                || billingIdentity != null && buyerName != null && !buyerName.isBlank() && billingAddress != null;
    }

    public CheckoutRequest(String addressId, String paymentMethod, String simulationOutcome, String cardNumber,
            String expectedCartId, String fulfillmentMethod, String pickupLocationId, String expectedQuoteFingerprint) {
        this(addressId, paymentMethod, simulationOutcome, cardNumber, expectedCartId, fulfillmentMethod,
                pickupLocationId, expectedQuoteFingerprint, null, null, null);
    }

    public CheckoutRequest {
        fulfillmentMethod = fulfillmentMethod == null ? "HOME_DELIVERY" : fulfillmentMethod;
    }

    @AssertTrue(message = "Selecciona los datos de entrega física o compra digital sin dirección ni retiro.")
    @com.fasterxml.jackson.annotation.JsonIgnore
    public boolean isFulfillmentValid() {
        return "HOME_DELIVERY".equals(fulfillmentMethod)
                ? addressId != null && pickupLocationId == null
                : "STORE_PICKUP".equals(fulfillmentMethod) ? addressId == null && pickupLocationId != null
                : "DIGITAL_ONLY".equals(fulfillmentMethod) && addressId == null && pickupLocationId == null;
    }

    public CheckoutRequest(String addressId, String paymentMethod, String simulationOutcome, String cardNumber, String expectedCartId) {
        this(addressId, paymentMethod, simulationOutcome, cardNumber, expectedCartId, "HOME_DELIVERY", null);
    }

    public CheckoutRequest(String addressId, String paymentMethod, String simulationOutcome, String cardNumber, String expectedCartId, String fulfillmentMethod, String pickupLocationId) {
        this(addressId, paymentMethod, simulationOutcome, cardNumber, expectedCartId, fulfillmentMethod, pickupLocationId, null);
    }

    public CheckoutRequest(String addressId, String paymentMethod, String simulationOutcome, String cardNumber) {
        this(addressId, paymentMethod, simulationOutcome, cardNumber, null);
    }

    @Override
    public String toString() {
        return "CheckoutRequest[addressId=" + addressId + ", paymentMethod=" + paymentMethod
                + ", simulationOutcome=" + simulationOutcome + ", cardNumber=[redacted]]";
    }
}
