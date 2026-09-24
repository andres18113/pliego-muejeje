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
import java.time.OffsetDateTime;
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
import com.pliego.modules.sales.application.AdminOrderModels.Address;
import com.pliego.modules.sales.application.AdminOrderModels.Cancellation;
import com.pliego.modules.sales.application.AdminOrderModels.Detail;
import com.pliego.modules.sales.application.AdminOrderModels.History;
import com.pliego.modules.sales.application.AdminOrderModels.InventoryMovement;
import com.pliego.modules.sales.application.AdminOrderModels.Item;
import com.pliego.modules.sales.application.AdminOrderModels.Page;
import com.pliego.modules.sales.application.AdminOrderModels.Payment;
import com.pliego.modules.sales.application.AdminOrderModels.Search;
import com.pliego.modules.sales.application.AdminOrderModels.Summary;
import com.pliego.modules.sales.application.AdminOrderModels.Transition;
import com.pliego.modules.sales.gateway.AdminOrderGateway;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i10_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(AdminOrderApiIntegrationTest.TestConfigurationForAdminOrders.class)
class AdminOrderApiIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer tokenIssuer;
    @Autowired DatabaseExceptionTranslator translator;
    @Autowired FakeAdminOrderGateway gateway;

    @BeforeEach void reset() { gateway.reset(); }

    @Test
    void allRoutesRequireAdminRole() throws Exception {
        for (var request : List.of(get("/api/v1/admin/orders"), get("/api/v1/admin/orders/700"),
                post("/api/v1/admin/orders/700/transitions").contentType("application/json")
                        .content("{\"targetState\":\"PREPARING\"}"),
                post("/api/v1/admin/orders/700/cancel"))) {
            mvc.perform(request).andExpect(status().isUnauthorized());
            mvc.perform(request.header("Authorization", token("42", "CUSTOMER")))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        }
        assertEquals(0, gateway.calls);

        mvc.perform(get("/api/v1/admin/orders").header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isOk());
        assertEquals(1, gateway.calls);
        assertEquals(7L, gateway.actor);
    }

    @Test
    void emptyAndPaginatedSearchPreservesIdsMoneyTimestampsAndFunctionFilters() throws Exception {
        mvc.perform(get("/api/v1/admin/orders").header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.page").value(0)).andExpect(jsonPath("$.pageSize").value(20))
                .andExpect(jsonPath("$.totalCount").value("0"));

        gateway.page = new Page(List.of(new Summary("9007199254740993", "9007199254740995", "Ana Pérez",
                Instant.parse("2026-09-23T20:00:00Z"), "PREPARING", new BigDecimal("39.80"), "APPROVED")), 33);
        String body = mvc.perform(get("/api/v1/admin/orders?state=PREPARING"
                        + "&dateFrom=2026-09-01T00:00:00Z&dateTo=2026-09-30T23:59:59Z"
                        + "&customerId=9007199254740995&page=1&pageSize=2")
                        .header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.pageSize").value(2)).andExpect(jsonPath("$.totalCount").value("33"))
                .andExpect(jsonPath("$.items[0].orderId").value("9007199254740993"))
                .andExpect(jsonPath("$.items[0].customerId").value("9007199254740995"))
                .andExpect(jsonPath("$.items[0].createdAt").value("2026-09-23T20:00:00Z"))
                .andExpect(jsonPath("$.items[0].total").value("39.80"))
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("\"orderId\":\"9007199254740993\""));
        assertFalse(body.contains("\"orderId\":9007199254740993"));
        assertEquals("PREPARING", gateway.search.state());
        assertEquals(OffsetDateTime.parse("2026-09-01T00:00:00Z"), gateway.search.dateFrom());
        assertEquals(OffsetDateTime.parse("2026-09-30T23:59:59Z"), gateway.search.dateTo());
        assertEquals(9007199254740995L, gateway.search.customerId());
        assertEquals(1, gateway.search.page());
        assertEquals(2, gateway.search.pageSize());
    }

    @Test
    void detailIncludesCustomerIdentityStoredSnapshotsPaymentHistoryAndInventoryMovements() throws Exception {
        String body = mvc.perform(get("/api/v1/admin/orders/700")
                        .header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orderId").value("700"))
                .andExpect(jsonPath("$.customerId").value("42"))
                .andExpect(jsonPath("$.customerEmail").value("ana@example.test"))
                .andExpect(jsonPath("$.customerName").value("Ana Pérez"))
                .andExpect(jsonPath("$.subtotal").value("39.80"))
                .andExpect(jsonPath("$.total").value("39.80"))
                .andExpect(jsonPath("$.items[0].orderItemId").value("800"))
                .andExpect(jsonPath("$.items[0].editionId").value("250"))
                .andExpect(jsonPath("$.items[0].title").value("Título histórico"))
                .andExpect(jsonPath("$.items[0].authors").value("Autora histórica"))
                .andExpect(jsonPath("$.items[0].publisher").value("Editorial histórica"))
                .andExpect(jsonPath("$.items[0].unitPrice").value("19.90"))
                .andExpect(jsonPath("$.address.recipient").value("Destinatario histórico"))
                .andExpect(jsonPath("$.payment.paymentId").value("900"))
                .andExpect(jsonPath("$.payment.amount").value("39.80"))
                .andExpect(jsonPath("$.stateHistory[1].actorUserId").value("7"))
                .andExpect(jsonPath("$.inventoryMovements[0].movementId").value("1200"))
                .andExpect(jsonPath("$.inventoryMovements[0].type").value("SALE"))
                .andExpect(jsonPath("$.inventoryMovements[0].stockBefore").value(11))
                .andExpect(jsonPath("$.inventoryMovements[0].stockAfter").value(9))
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("\"paymentId\":\"900\""));
        assertFalse(body.contains("\"paymentId\":900"));
        assertEquals(7L, gateway.actor);
        assertEquals(700L, gateway.orderId);
        assertEquals("detail", gateway.lastOperation);
    }

    @Test
    void nonexistentOrderReturnsSafeSpanish404() throws Exception {
        gateway.failure = failure("P5001", "private SQL, table names, and lock data");
        String body = mvc.perform(get("/api/v1/admin/orders/999999")
                        .header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("P5001"))
                .andExpect(jsonPath("$.title").value("Pedido no encontrado"))
                .andExpect(jsonPath("$.detail").value("El pedido solicitado no existe."))
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("private SQL"));
        assertFalse(body.contains("lock data"));
    }

    @Test
    void logisticsTransitionsFollowApprovedSequenceAndUseProcedureResults() throws Exception {
        transition("PREPARING", "CONFIRMED");
        transition("SHIPPED", "PREPARING");
        transition("DELIVERED", "SHIPPED");
        assertEquals("DELIVERED", gateway.orderState);
        assertEquals(3, gateway.calls);
    }

    @Test
    void skippedBackwardAndSameStateTransitionsReturnConflictAndCancelledIsRejected() throws Exception {
        gateway.orderState = "CONFIRMED";
        expectInvalidTransition("SHIPPED"); // skipped PREPARING
        gateway.orderState = "SHIPPED";
        expectInvalidTransition("PREPARING"); // backwards
        gateway.orderState = "PREPARING";
        expectInvalidTransition("PREPARING"); // same state

        int calls = gateway.calls;
        mvc.perform(post("/api/v1/admin/orders/700/transitions")
                        .header("Authorization", token("7", "ADMIN"))
                        .contentType("application/json").content("{\"targetState\":\"CANCELLED\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.title").value("Datos inválidos"));
        assertEquals(calls, gateway.calls);
    }

    @Test
    void adminCanCancelAnotherCustomersEligibleOrderAndRepeatedCancelConflicts() throws Exception {
        mvc.perform(post("/api/v1/admin/orders/700/cancel")
                        .header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.orderId").value("700"))
                .andExpect(jsonPath("$.previousState").value("CONFIRMED"))
                .andExpect(jsonPath("$.orderState").value("CANCELLED"))
                .andExpect(jsonPath("$.paymentState").value("REFUNDED"))
                .andExpect(jsonPath("$.restoredUnits").value(2));
        assertEquals(7L, gateway.actor);
        assertEquals("cancel", gateway.lastOperation);

        String body = mvc.perform(post("/api/v1/admin/orders/700/cancel")
                        .header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P5003"))
                .andExpect(jsonPath("$.title").value("Pedido no cancelable"))
                .andExpect(jsonPath("$.detail").value("El pedido ya no puede cancelarse en su estado actual."))
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("ORDER_NOT_CANCELLABLE"));
    }

    @Test
    void shippedAndDeliveredOrdersCannotBeCancelled() throws Exception {
        for (String state : List.of("SHIPPED", "DELIVERED")) {
            gateway.orderState = state;
            mvc.perform(post("/api/v1/admin/orders/700/cancel")
                            .header("Authorization", token("7", "ADMIN")))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P5003"));
        }
        assertEquals(2, gateway.calls);
    }

    @Test
    void invalidPaymentAndDatabaseMovementErrorsAreSafeSpanishProblems() throws Exception {
        gateway.failure = failure("P5006", "private payment and constraint names");
        String body = mvc.perform(post("/api/v1/admin/orders/700/cancel")
                        .header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P5006"))
                .andExpect(jsonPath("$.title").value("Estado de pago inválido"))
                .andExpect(jsonPath("$.detail").value(
                        "No es posible completar la operación con el estado actual del pago."))
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("constraint"));
        assertFalse(body.contains("private payment"));

        gateway.failure = failure("P3005", "unique constraint and row lock");
        body = mvc.perform(post("/api/v1/admin/orders/700/cancel")
                        .header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isConflict()).andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("unique constraint"));
        assertFalse(body.contains("row lock"));
    }

    @Test
    void invalidPaginationAndIdentifiersFailBeforeGateway() throws Exception {
        for (String path : List.of("/api/v1/admin/orders?page=-1", "/api/v1/admin/orders?pageSize=0",
                "/api/v1/admin/orders?pageSize=51", "/api/v1/admin/orders?customerId=0",
                "/api/v1/admin/orders/0")) {
            mvc.perform(get(path).header("Authorization", token("7", "ADMIN")))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/v1/admin/orders/-1/cancel")
                        .header("Authorization", token("7", "ADMIN")))
                .andExpect(status().isBadRequest());
        assertEquals(0, gateway.calls);
    }

    private void transition(String target, String previous) throws Exception {
        mvc.perform(post("/api/v1/admin/orders/700/transitions")
                        .header("Authorization", token("7", "ADMIN"))
                        .contentType("application/json").content("{\"targetState\":\"" + target + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.orderId").value("700"))
                .andExpect(jsonPath("$.previousState").value(previous))
                .andExpect(jsonPath("$.orderState").value(target));
        assertEquals(7L, gateway.actor);
        assertEquals(700L, gateway.orderId);
    }

    private void expectInvalidTransition(String target) throws Exception {
        String body = mvc.perform(post("/api/v1/admin/orders/700/transitions")
                        .header("Authorization", token("7", "ADMIN"))
                        .contentType("application/json").content("{\"targetState\":\"" + target + "\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P5002"))
                .andExpect(jsonPath("$.title").value("Cambio de estado inválido"))
                .andExpect(jsonPath("$.detail").value(
                        "El pedido no puede pasar al estado solicitado desde su estado actual."))
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("ORDER_INVALID_TRANSITION"));
    }

    private DatabaseException failure(String state, String message) {
        return translator.translate(new SQLException(message, state));
    }

    private String token(String actor, String role) {
        Instant issued = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(actor, role, issued, issued.plusSeconds(1800), UUID.randomUUID().toString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestConfigurationForAdminOrders {
        @Bean PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) { return new SimpleTransactionStatus(); }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }

        @Bean @Primary FakeAdminOrderGateway adminOrderGateway() { return new FakeAdminOrderGateway(); }
    }

    static class FakeAdminOrderGateway implements AdminOrderGateway {
        int calls;
        long actor;
        long orderId;
        String lastOperation;
        String orderState = "CONFIRMED";
        DatabaseException failure;
        Page page = new Page(List.of(), 0);
        Search search;

        void reset() {
            calls = 0;
            actor = 0;
            orderId = 0;
            lastOperation = null;
            orderState = "CONFIRMED";
            failure = null;
            page = new Page(List.of(), 0);
            search = null;
        }

        private void called(String operation, long actorUserId) {
            calls++;
            lastOperation = operation;
            actor = actorUserId;
            if (failure != null) throw failure;
        }

        @Override public Page search(long actorUserId, Search query) {
            called("search", actorUserId);
            search = query;
            return page;
        }

        @Override public Detail detail(long actorUserId, long requestedOrderId) {
            called("detail", actorUserId);
            orderId = requestedOrderId;
            return sampleDetail();
        }

        @Override public Transition transition(long actorUserId, long requestedOrderId, String targetState) {
            called("transition", actorUserId);
            orderId = requestedOrderId;
            boolean valid = ("CONFIRMED".equals(orderState) && "PREPARING".equals(targetState))
                    || ("PREPARING".equals(orderState) && "SHIPPED".equals(targetState))
                    || ("SHIPPED".equals(orderState) && "DELIVERED".equals(targetState));
            if (!valid) throw new DatabaseExceptionTranslator().translate(
                    new SQLException("transition conflict", "P5002"));
            String previous = orderState;
            orderState = targetState;
            return new Transition(Long.toString(requestedOrderId), previous, orderState);
        }

        @Override public Cancellation cancel(long actorUserId, long requestedOrderId) {
            called("cancel", actorUserId);
            orderId = requestedOrderId;
            if (!("CONFIRMED".equals(orderState) || "PREPARING".equals(orderState))) {
                throw new DatabaseExceptionTranslator().translate(new SQLException("not cancellable", "P5003"));
            }
            String previous = orderState;
            orderState = "CANCELLED";
            return new Cancellation(Long.toString(requestedOrderId), previous, orderState, "REFUNDED", 2);
        }

        private static Detail sampleDetail() {
            return new Detail("700", "42", "ana@example.test", "Ana Pérez", "CONFIRMED",
                    new BigDecimal("39.80"), new BigDecimal("39.80"),
                    Instant.parse("2026-09-23T19:30:00Z"), Instant.parse("2026-09-23T19:31:00Z"),
                    List.of(new Item("800", "250", "SKU-AT-PURCHASE", "9780306406157",
                            "Título histórico", "Autora histórica", "Editorial histórica", "PAPERBACK", "es",
                            new BigDecimal("19.90"), 2, new BigDecimal("39.80"))),
                    new Address("Destinatario histórico", "Calle en compra", null, "Quito", "Pichincha",
                            "EC", null, "Referencia en compra", "+59325550134"),
                    new Payment("900", "CARD", "APPROVED", new BigDecimal("39.80"),
                            "SIM-550e8400-e29b-41d4-a716-446655440000", null,
                            "2026-09-23T19:30:00Z", "2026-09-23T19:31:00Z"),
                    List.of(new History("1000", null, "SYSTEM", null, "PENDING_PAYMENT",
                                    "2026-09-23T19:30:00Z"),
                            new History("1001", "7", "USER", "PREPARING", "CONFIRMED",
                                    "2026-09-23T19:31:00Z")),
                    List.of(new InventoryMovement("1200", "250", "700", null, "SALE", 2, 11, 9,
                            null, "2026-09-23T19:30:00Z")));
        }
    }
}
