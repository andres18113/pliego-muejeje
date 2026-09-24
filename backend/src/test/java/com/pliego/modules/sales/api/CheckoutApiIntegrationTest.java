package com.pliego.modules.sales.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.pliego.foundation.database.DatabaseException;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.sales.application.CheckoutResult;
import com.pliego.modules.sales.gateway.CheckoutGateway;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i8_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(CheckoutApiIntegrationTest.TestConfigurationForCheckout.class)
@ExtendWith(OutputCaptureExtension.class)
class CheckoutApiIntegrationTest {

    private static final String CARD = "4242424242424242";
    private static final String APPROVED_REFERENCE = "SIM-550e8400-e29b-41d4-a716-446655440000";
    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer tokenIssuer;
    @Autowired DatabaseExceptionTranslator translator;
    @Autowired FakeCheckoutGateway gateway;

    @BeforeEach void reset() { gateway.reset(); }

    @Test
    void checkoutRequestStringRepresentationRedactsPan() {
        CheckoutRequest request = new CheckoutRequest("15", "CARD", "APPROVED", CARD);

        assertFalse(request.toString().contains(CARD));
        assertTrue(request.toString().contains("cardNumber=[redacted]"));
    }

    @Test
    void validCardApprovedCreatesOrderWithExactMoneyStringAndLocation(CapturedOutput output) throws Exception {
        String body = perform("{\"addressId\":\"15\",\"paymentMethod\":\"CARD\",\"simulationOutcome\":\"APPROVED\",\"cardNumber\":\"" + CARD + "\"}")
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/orders/700"))
                .andExpect(jsonPath("$.orderId").value("700"))
                .andExpect(jsonPath("$.orderState").value("CONFIRMED"))
                .andExpect(jsonPath("$.paymentState").value("APPROVED"))
                .andExpect(jsonPath("$.total").value("39.80"))
                .andExpect(jsonPath("$.paymentReference").value(APPROVED_REFERENCE))
                .andReturn().getResponse().getContentAsString();
        assertTrue(APPROVED_REFERENCE.matches("SIM-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"));
        assertTrue(body.contains("\"orderId\":\"700\""));
        assertFalse(body.contains(CARD));
        assertFalse(output.getAll().contains(CARD));
        assertEquals(1, gateway.calls);
        assertEquals(42L, gateway.actor);
        assertEquals(15L, gateway.address);
        assertEquals("CARD", gateway.method);
        assertEquals("APPROVED", gateway.outcome);
    }

    @Test
    void validCardRejectedStillCreatesCancelledOrderWithoutReference(CapturedOutput output) throws Exception {
        gateway.result = new CheckoutResult("701", "CANCELLED", "REJECTED", new BigDecimal("39.80"), null);
        String body = perform("{\"addressId\":\"15\",\"paymentMethod\":\"CARD\",\"simulationOutcome\":\"REJECTED\",\"cardNumber\":\"" + CARD + "\"}")
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/orders/701"))
                .andExpect(jsonPath("$.orderState").value("CANCELLED"))
                .andExpect(jsonPath("$.paymentState").value("REJECTED"))
                .andExpect(jsonPath("$.paymentReference").value(org.hamcrest.Matchers.nullValue()))
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains(CARD));
        assertFalse(output.getAll().contains(CARD));
        assertEquals(1, gateway.calls);
        assertEquals("REJECTED", gateway.outcome);
    }

    @Test
    void invalidCardFormsAreRejectedBeforeDatabaseAndNeverExposed(CapturedOutput output) throws Exception {
        for (String cardJson : new String[] {"\"4242424242424241\"", "\"4242x24242424242\"", "null", "\"123\""}) {
            String body = perform("{\"addressId\":\"15\",\"paymentMethod\":\"CARD\",\"simulationOutcome\":\"APPROVED\",\"cardNumber\":" + cardJson + "}")
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_CARD_NUMBER"))
                    .andExpect(jsonPath("$.title").value("Tarjeta inválida"))
                    .andExpect(jsonPath("$.detail").value("El número de tarjeta no es válido."))
                    .andReturn().getResponse().getContentAsString();
            assertFalse(body.contains("4242424242424241"));
            assertFalse(body.contains("4242x24242424242"));
        }
        perform("{\"addressId\":\"15\",\"paymentMethod\":\"CARD\",\"simulationOutcome\":\"APPROVED\"}")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.title").value("Tarjeta inválida"));
        assertEquals(0, gateway.calls);
        assertFalse(output.getAll().contains("4242424242424241"));
        assertFalse(output.getAll().contains("4242x24242424242"));
    }

    @Test
    void transferForbidsAnyCardNumberAndSucceedsWithoutOne() throws Exception {
        perform("{\"addressId\":\"15\",\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"APPROVED\",\"cardNumber\":\"" + CARD + "\"}")
                .andExpect(status().isBadRequest());
        perform("{\"addressId\":\"15\",\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"APPROVED\",\"cardNumber\":\"\"}")
                .andExpect(status().isBadRequest());
        assertEquals(0, gateway.calls);
        perform("{\"addressId\":\"15\",\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"APPROVED\"}")
                .andExpect(status().isCreated());
        assertEquals(1, gateway.calls);
        assertEquals("TRANSFER", gateway.method);
        perform("{\"addressId\":\"15\",\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"REJECTED\",\"cardNumber\":null}")
                .andExpect(status().isCreated());
        assertEquals(2, gateway.calls);
        assertEquals("REJECTED", gateway.outcome);
    }

    @Test
    void invalidSimulationOutcomeIsPassedToDatabaseForApprovedCode() throws Exception {
        gateway.failure = translator.translate(new SQLException("private outcome detail", "P5005"));
        perform("{\"addressId\":\"15\",\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"UNKNOWN\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("P5005"))
                .andExpect(jsonPath("$.detail").value("El resultado de simulación seleccionado no es válido."));
        assertEquals(1, gateway.calls);
        assertEquals("UNKNOWN", gateway.outcome);
    }

    @Test
    void onlyVerifiedCustomerJwtCanChooseActor() throws Exception {
        String valid = "{\"addressId\":\"15\",\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"APPROVED\"}";
        mvc.perform(post("/api/v1/checkout").contentType(MediaType.APPLICATION_JSON).content(valid))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/checkout").header("Authorization", token("7", "ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON).content(valid))
                .andExpect(status().isForbidden());
        perform("{\"addressId\":\"15\",\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"APPROVED\",\"actorUserId\":\"7\"}")
                .andExpect(status().isBadRequest());
        assertEquals(0, gateway.calls);
        perform(valid).andExpect(status().isCreated());
        assertEquals(42L, gateway.actor);
    }

    @Test
    void invalidAddressIdFailsBeforeDatabase() throws Exception {
        for (String id : new String[] {"0", "-1", "9223372036854775808", "abc"}) {
            perform("{\"addressId\":\"" + id + "\",\"paymentMethod\":\"TRANSFER\",\"simulationOutcome\":\"APPROVED\"}")
                    .andExpect(status().isBadRequest());
        }
        assertEquals(0, gateway.calls);
    }

    @Test
    void databaseErrorsPreserveCodesAndUseSafeSpanishFeedback(CapturedOutput output) throws Exception {
        record Case(String state, int status, String title, String detail) { }
        Case[] cases = {
                new Case("P4001", 409, "Carrito no disponible", "No hay un carrito activo para finalizar la compra."),
                new Case("P4002", 409, "Carrito vacío", "Agrega al menos un libro antes de finalizar la compra."),
                new Case("P2042", 409, "Edición no disponible", "Una de las ediciones del carrito ya no está disponible."),
                new Case("P2043", 409, "Libro no disponible", "Uno de los libros del carrito ya no está disponible."),
                new Case("P3002", 409, "Existencias insuficientes", "Uno o más libros ya no tienen existencias suficientes."),
                new Case("P5004", 404, "Dirección no disponible", "La dirección seleccionada no está disponible."),
                new Case("P5005", 400, "Resultado de pago inválido", "El resultado de simulación seleccionado no es válido."),
                new Case("P5006", 409, "Estado de pago inválido", "El estado del pago no permite finalizar la compra."),
                new Case("P5007", 500, "No se pudo completar el pago", "No se pudo completar el pago simulado. Intenta nuevamente.")
        };
        for (Case current : cases) {
            gateway.failure = translator.translate(new SQLException("private SQL constraint and owner detail", current.state()));
            String body = perform("{\"addressId\":\"15\",\"paymentMethod\":\"CARD\",\"simulationOutcome\":\"APPROVED\",\"cardNumber\":\"" + CARD + "\"}")
                    .andExpect(status().is(current.status()))
                    .andExpect(jsonPath("$.code").value(current.state()))
                    .andExpect(jsonPath("$.title").value(current.title()))
                    .andExpect(jsonPath("$.detail").value(current.detail()))
                    .andReturn().getResponse().getContentAsString();
            assertFalse(body.contains(CARD));
            assertFalse(body.contains("private SQL"));
            assertFalse(body.contains("constraint"));
        }
        assertEquals(cases.length, gateway.calls);
        assertFalse(output.getAll().contains(CARD));
    }

    private org.springframework.test.web.servlet.ResultActions perform(String body) throws Exception {
        return mvc.perform(post("/api/v1/checkout").header("Authorization", token("42", "CUSTOMER"))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private String token(String actor, String role) {
        Instant issued = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(actor, role, issued, issued.plusSeconds(1800), UUID.randomUUID().toString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestConfigurationForCheckout {
        @Bean PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) { return new SimpleTransactionStatus(); }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }

        @Bean @Primary FakeCheckoutGateway checkoutGateway() { return new FakeCheckoutGateway(); }
    }

    static class FakeCheckoutGateway implements CheckoutGateway {
        int calls;
        long actor;
        long address;
        String method;
        String outcome;
        DatabaseException failure;
        CheckoutResult result;

        void reset() {
            calls = 0;
            actor = 0;
            address = 0;
            method = null;
            outcome = null;
            failure = null;
            result = new CheckoutResult("700", "CONFIRMED", "APPROVED", new BigDecimal("39.80"), APPROVED_REFERENCE);
        }

        @Override public CheckoutResult checkout(long actorUserId, long addressId, String paymentMethod,
                String paymentOutcome) {
            calls++;
            actor = actorUserId;
            address = addressId;
            method = paymentMethod;
            outcome = paymentOutcome;
            if (failure != null) throw failure;
            return result;
        }
    }
}
