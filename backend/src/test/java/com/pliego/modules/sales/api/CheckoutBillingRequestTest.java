package com.pliego.modules.sales.api;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import jakarta.validation.Validation;
import tools.jackson.databind.json.JsonMapper;

class CheckoutBillingRequestTest {
    private final JsonMapper mapper = JsonMapper.builder().build();
    private static final String BILLING = """
        {"paymentMethod":"TRANSFER","simulationOutcome":"PENDING","fulfillmentMethod":"DIGITAL_ONLY",
         "billingIdentity":{"type":"EC_CEDULA","number":" 0912345675 "},
         "buyerName":"Comprador Fiscal","billingAddress":{"line1":"Calle Fiscal","city":"Quito","province":"Pichincha","countryCode":"EC"}}
        """;

    @Test void preservesIndependentFiscalSnapshotAndRedactsItFromToString() {
        CheckoutRequest request = mapper.readValue(BILLING, CheckoutRequest.class);
        var json = mapper.valueToTree(request);
        assertEquals("0912345675", json.path("billingIdentity").path("number").asText());
        assertEquals("Comprador Fiscal", json.path("buyerName").asText());
        assertEquals("Calle Fiscal", json.path("billingAddress").path("line1").asText());
        assertFalse(request.toString().contains("0912345675"));
        assertFalse(request.toString().contains("Comprador Fiscal"));
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(request).isEmpty());
        }
    }
    @Test void rejectsInvalidIdentityAndPartialBillingBeforeGateway() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertFalse(validator.validate(mapper.readValue(BILLING.replace("0912345675", "0012345670"), CheckoutRequest.class)).isEmpty());
            assertFalse(validator.validate(mapper.readValue(BILLING.replace("\"buyerName\":\"Comprador Fiscal\",", ""), CheckoutRequest.class)).isEmpty());
        }
    }
    @Test void everyPurchaseRequiresCedulaBuyerAndBillingAddress() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            CheckoutRequest unbilled = mapper.readValue("{\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"APPROVED\",\"fulfillmentMethod\":\"DIGITAL_ONLY\"}", CheckoutRequest.class);
            var messages = validator.validate(unbilled).stream().map(jakarta.validation.ConstraintViolation::getMessage).toList();
            assertTrue(messages.contains("Escribe tu cédula o RUC: es obligatorio para comprar."));
            assertTrue(messages.contains("Escribe el nombre para la factura."));
            assertTrue(messages.contains("Completa la dirección de facturación."));
            assertFalse(validator.validate(mapper.readValue(BILLING.replace("\"billingIdentity\":{\"type\":\"EC_CEDULA\",\"number\":\" 0912345675 \"},", ""), CheckoutRequest.class)).isEmpty());
        }
    }
}
