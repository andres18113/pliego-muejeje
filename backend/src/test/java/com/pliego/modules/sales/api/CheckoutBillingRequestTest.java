package com.pliego.modules.sales.api;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import jakarta.validation.Validation;
import tools.jackson.databind.json.JsonMapper;

class CheckoutBillingRequestTest {
    private final JsonMapper mapper = JsonMapper.builder().build();
    private static final String BILLING = """
        {"paymentMethod":"TRANSFER","simulationOutcome":"PENDING","fulfillmentMethod":"DIGITAL_ONLY",
         "billingIdentity":{"type":"EC_CEDULA","number":" 0012345674 "},
         "buyerName":"Comprador Fiscal","billingAddress":{"line1":"Calle Fiscal","city":"Quito","province":"Pichincha","countryCode":"EC"}}
        """;

    @Test void preservesIndependentFiscalSnapshotAndRedactsItFromToString() {
        CheckoutRequest request = mapper.readValue(BILLING, CheckoutRequest.class);
        var json = mapper.valueToTree(request);
        assertEquals("0012345674", json.path("billingIdentity").path("number").asText());
        assertEquals("Comprador Fiscal", json.path("buyerName").asText());
        assertEquals("Calle Fiscal", json.path("billingAddress").path("line1").asText());
        assertFalse(request.toString().contains("0012345674"));
        assertFalse(request.toString().contains("Comprador Fiscal"));
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(request).isEmpty());
        }
    }
    @Test void rejectsInvalidIdentityAndPartialBillingBeforeGateway() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            assertFalse(validator.validate(mapper.readValue(BILLING.replace("0012345674", "0012345670"), CheckoutRequest.class)).isEmpty());
            assertFalse(validator.validate(mapper.readValue(BILLING.replace("\"buyerName\":\"Comprador Fiscal\",", ""), CheckoutRequest.class)).isEmpty());
        }
    }
    @Test void oldClientsRemainValidWithoutFiscalFields() {
        CheckoutRequest request = mapper.readValue("{\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"APPROVED\",\"fulfillmentMethod\":\"DIGITAL_ONLY\"}", CheckoutRequest.class);
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(request).isEmpty());
        }
    }
}
