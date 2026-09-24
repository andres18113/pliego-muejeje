package com.pliego.modules.sales.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.pliego.foundation.database.DatabaseException;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.sales.application.OrderModels.Address;
import com.pliego.modules.sales.application.OrderModels.Cancellation;
import com.pliego.modules.sales.application.OrderModels.Detail;
import com.pliego.modules.sales.application.OrderModels.History;
import com.pliego.modules.sales.application.OrderModels.Item;
import com.pliego.modules.sales.application.OrderModels.Page;
import com.pliego.modules.sales.application.OrderModels.Payment;
import com.pliego.modules.sales.application.OrderModels.Summary;
import com.pliego.modules.sales.gateway.CustomerOrderGateway;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i9_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(CustomerOrderApiIntegrationTest.TestConfigurationForOrders.class)
class CustomerOrderApiIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer tokenIssuer;
    @Autowired DatabaseExceptionTranslator translator;
    @Autowired FakeCustomerOrderGateway gateway;

    @BeforeEach void reset() { gateway.reset(); }

    @Test
    void onlyCustomerMayUseEachEndpoint() throws Exception {
        for (var request : List.of(get("/api/v1/orders"), get("/api/v1/orders/700"),
                post("/api/v1/orders/700/cancel"))) {
            mvc.perform(request).andExpect(status().isUnauthorized());
            mvc.perform(request.header("Authorization", token("7", "ADMIN")))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        }
        assertEquals(0, gateway.calls);
    }

    @Test
    void emptyAndPaginatedListsPreserveFunctionOrderAndExactFormats() throws Exception {
        mvc.perform(get("/api/v1/orders").header("Authorization", token("42", "CUSTOMER")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.page").value(0)).andExpect(jsonPath("$.pageSize").value(20))
                .andExpect(jsonPath("$.totalCount").value("0"));
        assertEquals(42L, gateway.actor);

        gateway.page = new Page(List.of(
                new Summary("9007199254740993", Instant.parse("2026-09-23T20:00:00Z"),
                        "CONFIRMED", new BigDecimal("39.80"), "APPROVED"),
                new Summary("700", Instant.parse("2026-09-23T19:30:00Z"),
                        "CANCELLED", new BigDecimal("12.35"), "REJECTED")), 12);
        String body = mvc.perform(get("/api/v1/orders?page=1&pageSize=2&actorUserId=7")
                        .header("Authorization", token("42", "CUSTOMER")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.pageSize").value(2))
                .andExpect(jsonPath("$.totalCount").value("12"))
                .andExpect(jsonPath("$.items[0].orderId").value("9007199254740993"))
                .andExpect(jsonPath("$.items[0].createdAt").value("2026-09-23T20:00:00Z"))
                .andExpect(jsonPath("$.items[0].total").value("39.80"))
                .andExpect(jsonPath("$.items[1].orderId").value("700"))
                .andExpect(jsonPath("$.items[1].total").value("12.35"))
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("\"orderId\":\"9007199254740993\""));
        assertFalse(body.contains("\"orderId\":9007199254740993"));
        assertEquals(42L, gateway.actor);
        assertEquals(1, gateway.pageNumber);
        assertEquals(2, gateway.pageSize);
    }

    @Test
    void detailReturnsImmutableSnapshotsPaymentAndHistoryWithoutReconstruction() throws Exception {
        String body = mvc.perform(get("/api/v1/orders/700?actorUserId=7")
                        .header("Authorization", token("42", "CUSTOMER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orderId").value("700"))
                .andExpect(jsonPath("$.orderState").value("CONFIRMED"))
                .andExpect(jsonPath("$.subtotal").value("39.80"))
                .andExpect(jsonPath("$.total").value("39.80"))
                .andExpect(jsonPath("$.items[0].orderItemId").value("800"))
                .andExpect(jsonPath("$.items[0].editionId").value("250"))
                .andExpect(jsonPath("$.items[0].title").value("Título en compra"))
                .andExpect(jsonPath("$.items[0].authors").value("Autora en compra"))
                .andExpect(jsonPath("$.items[0].publisher").value("Editorial en compra"))
                .andExpect(jsonPath("$.items[0].unitPrice").value("19.90"))
                .andExpect(jsonPath("$.items[0].subtotal").value("39.80"))
                .andExpect(jsonPath("$.address.recipient").value("Cliente en compra"))
                .andExpect(jsonPath("$.address.line1").value("Calle en compra"))
                .andExpect(jsonPath("$.payment.paymentId").value("900"))
                .andExpect(jsonPath("$.payment.amount").value("39.80"))
                .andExpect(jsonPath("$.payment.reference").value("SIM-550e8400-e29b-41d4-a716-446655440000"))
                .andExpect(jsonPath("$.stateHistory[0].historyId").value("1000"))
                .andExpect(jsonPath("$.stateHistory[0].actorUserId").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.stateHistory[1].newState").value("CONFIRMED"))
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("\"paymentId\":\"900\""));
        assertFalse(body.contains("\"paymentId\":900"));
        assertEquals(42L, gateway.actor);
        assertEquals(700L, gateway.orderId);
        assertEquals("detail", gateway.lastOperation);
    }

    @Test
    void foreignAndMissingOrdersHaveIdenticalSafe404ForDetailAndCancellation() throws Exception {
        gateway.failure = translator.translate(new SQLException("private SQL and customer ownership", "P5001"));
        for (long id : List.of(700L, 999999L)) {
            for (var request : List.of(get("/api/v1/orders/" + id),
                    post("/api/v1/orders/" + id + "/cancel"))) {
                String body = mvc.perform(request.header("Authorization", token("42", "CUSTOMER")))
                        .andExpect(status().isNotFound())
                        .andExpect(jsonPath("$.code").value("P5001"))
                        .andExpect(jsonPath("$.title").value("Pedido no encontrado"))
                        .andExpect(jsonPath("$.detail")
                                .value("El pedido solicitado no existe o no está disponible para tu cuenta."))
                        .andReturn().getResponse().getContentAsString();
                assertFalse(body.contains("ownership"));
                assertFalse(body.contains("private SQL"));
            }
        }
    }

    @Test
    void cancellationFromConfirmedOrPreparingReturnsProcedureResult() throws Exception {
        for (String prior : List.of("CONFIRMED", "PREPARING")) {
            gateway.cancellation = new Cancellation("700", prior, "CANCELLED", "REFUNDED", 2);
            mvc.perform(post("/api/v1/orders/700/cancel?actorUserId=7")
                            .header("Authorization", token("42", "CUSTOMER")))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.orderId").value("700"))
                    .andExpect(jsonPath("$.previousState").value(prior))
                    .andExpect(jsonPath("$.orderState").value("CANCELLED"))
                    .andExpect(jsonPath("$.paymentState").value("REFUNDED"))
                    .andExpect(jsonPath("$.restoredUnits").value(2));
            assertEquals(42L, gateway.actor);
            assertEquals(700L, gateway.orderId);
            assertEquals("cancel", gateway.lastOperation);
        }
        assertEquals(2, gateway.calls);
    }

    @Test
    void secondCancellationAndNoncancellableOrdersReturnConflict() throws Exception {
        for (String state : List.of("CANCELLED", "SHIPPED", "DELIVERED", "REJECTED_PAYMENT_CANCELLED")) {
            gateway.failure = translator.translate(new SQLException("private " + state, "P5003"));
            mvc.perform(post("/api/v1/orders/700/cancel")
                            .header("Authorization", token("42", "CUSTOMER")))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("P5003"))
                    .andExpect(jsonPath("$.title").value("Pedido no cancelable"))
                    .andExpect(jsonPath("$.detail")
                            .value("El pedido ya no puede cancelarse en su estado actual."));
        }
        assertEquals(4, gateway.calls);
    }

    @Test
    void paymentAndMovementFailuresUseSafeSpanishFeedback() throws Exception {
        for (String state : List.of("P5006", "P3005", "P3006")) {
            gateway.failure = translator.translate(new SQLException("private constraint and locks", state));
            String body = mvc.perform(post("/api/v1/orders/700/cancel")
                            .header("Authorization", token("42", "CUSTOMER")))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value(state))
                    .andReturn().getResponse().getContentAsString();
            assertFalse(body.contains("constraint"));
            assertFalse(body.contains("locks"));
        }
        assertEquals(3, gateway.calls);
    }

    @Test
    void invalidPaginationAndIdentifiersFailBeforeGateway() throws Exception {
        for (String path : List.of("/api/v1/orders?page=-1", "/api/v1/orders?pageSize=0",
                "/api/v1/orders?pageSize=51", "/api/v1/orders/0")) {
            mvc.perform(get(path).header("Authorization", token("42", "CUSTOMER")))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/v1/orders/-1/cancel")
                        .header("Authorization", token("42", "CUSTOMER")))
                .andExpect(status().isBadRequest());
        assertEquals(0, gateway.calls);
    }

    private String token(String actor, String role) {
        Instant issued = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(actor, role, issued, issued.plusSeconds(1800), UUID.randomUUID().toString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestConfigurationForOrders {
        @Bean PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) { return new SimpleTransactionStatus(); }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }

        @Bean @Primary FakeCustomerOrderGateway customerOrderGateway() { return new FakeCustomerOrderGateway(); }
    }

    static class FakeCustomerOrderGateway implements CustomerOrderGateway {
        int calls;
        long actor;
        long orderId;
        int pageNumber;
        int pageSize;
        String lastOperation;
        DatabaseException failure;
        Page page;
        Detail detail;
        Cancellation cancellation;

        void reset() {
            calls = 0;
            actor = 0;
            orderId = 0;
            pageNumber = 0;
            pageSize = 0;
            lastOperation = null;
            failure = null;
            page = new Page(List.of(), 0);
            detail = sampleDetail();
            cancellation = new Cancellation("700", "CONFIRMED", "CANCELLED", "REFUNDED", 2);
        }

        private void called(String operation, long actorUserId) {
            calls++;
            lastOperation = operation;
            actor = actorUserId;
            if (failure != null) throw failure;
        }

        @Override public Page list(long actorUserId, int page, int pageSize) {
            called("list", actorUserId);
            pageNumber = page;
            this.pageSize = pageSize;
            return this.page;
        }

        @Override public Detail detail(long actorUserId, long orderId) {
            called("detail", actorUserId);
            this.orderId = orderId;
            return detail;
        }

        @Override public Cancellation cancel(long actorUserId, long orderId) {
            called("cancel", actorUserId);
            this.orderId = orderId;
            return cancellation;
        }

        private static Detail sampleDetail() {
            return new Detail("700", "CONFIRMED", new BigDecimal("39.80"), new BigDecimal("39.80"),
                    Instant.parse("2026-09-23T19:30:00Z"), Instant.parse("2026-09-23T19:31:00Z"),
                    List.of(new Item("800", "250", "SKU-AT-PURCHASE", "9780306406157",
                            "Título en compra", "Autora en compra", "Editorial en compra", "PAPERBACK", "es",
                            new BigDecimal("19.90"), 2, new BigDecimal("39.80"))),
                    new Address("Cliente en compra", "Calle en compra", null, "Quito", "Pichincha",
                            "EC", null, "Referencia en compra", "+59325550134"),
                    new Payment("900", "CARD", "APPROVED", new BigDecimal("39.80"),
                            "SIM-550e8400-e29b-41d4-a716-446655440000", null,
                            "2026-09-23T19:30:00Z", "2026-09-23T19:31:00Z"),
                    List.of(new History("1000", null, "SYSTEM", null, "PENDING_PAYMENT",
                                    "2026-09-23T19:30:00Z"),
                            new History("1001", null, "SYSTEM", "PENDING_PAYMENT", "CONFIRMED",
                                    "2026-09-23T19:31:00Z")));
        }
    }
}
