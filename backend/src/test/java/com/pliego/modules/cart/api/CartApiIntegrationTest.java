package com.pliego.modules.cart.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
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
import com.pliego.modules.cart.application.CartModels.Cart;
import com.pliego.modules.cart.application.CartModels.CartItem;
import com.pliego.modules.cart.application.CartModels.CartItemResult;
import com.pliego.modules.cart.gateway.CartGateway;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i7_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(CartApiIntegrationTest.TestConfigurationForCart.class)
class CartApiIntegrationTest {

    private static final String ADD_BODY = "{\"editionId\":\"250\",\"quantity\":2}";
    private static final String UPDATE_BODY = "{\"quantity\":3}";

    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer tokenIssuer;
    @Autowired DatabaseExceptionTranslator exceptionTranslator;
    @Autowired FakeCartGateway gateway;

    @BeforeEach
    void resetGateway() {
        gateway.reset();
    }

    @Test
    void customerCanReadEmptyCartAndCallEveryCartCommandUsingJwtActor() throws Exception {
        mvc.perform(get("/api/v1/cart").header("Authorization", customerToken("42")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cartId").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.state").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.totalCurrent").value("0.00"));

        gateway.nextResult = new CartItemResult("40", "100", 2);
        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADD_BODY))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cartId").value("40"))
                .andExpect(jsonPath("$.cartItemId").value("100")).andExpect(jsonPath("$.quantity").value(2));
        assertTrue(gateway.lastEditionId == 250L);
        assertEquals(2, gateway.lastQuantity);

        gateway.nextResult = new CartItemResult("40", "100", 3);
        mvc.perform(put("/api/v1/cart/items/100").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON).content(UPDATE_BODY))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cartId").value("40"))
                .andExpect(jsonPath("$.cartItemId").value("100")).andExpect(jsonPath("$.quantity").value(3));

        mvc.perform(delete("/api/v1/cart/items/100").header("Authorization", customerToken("42")))
                .andExpect(status().isNoContent()).andExpect(content().string(""));

        assertEquals(List.of("get", "add", "update", "remove"), gateway.calls);
        assertEquals(42L, gateway.lastActorId);
        assertEquals(100L, gateway.lastCartItemId);
    }

    @Test
    void publicAndAdminActorsCannotAccessAnyCartEndpoint() throws Exception {
        List<Endpoint> endpoints = List.of(
                new Endpoint("GET", "/api/v1/cart", null),
                new Endpoint("POST", "/api/v1/cart/items", ADD_BODY),
                new Endpoint("PUT", "/api/v1/cart/items/100", UPDATE_BODY),
                new Endpoint("DELETE", "/api/v1/cart/items/100", null));
        for (Endpoint endpoint : endpoints) {
            mvc.perform(endpoint.request()).andExpect(status().isUnauthorized());
            mvc.perform(endpoint.request().header("Authorization", adminToken("7")))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        }
        assertTrue(gateway.calls.isEmpty());
    }

    @Test
    void firstAddAndRepeatedEditionAddReturnProcedureResultsAsStringIds() throws Exception {
        gateway.nextResult = new CartItemResult("40", "100", 1);
        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"editionId\":\"250\",\"quantity\":1}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cartId").value("40"))
                .andExpect(jsonPath("$.cartItemId").value("100")).andExpect(jsonPath("$.quantity").value(1));

        gateway.nextResult = new CartItemResult("40", "100", 3);
        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"editionId\":\"250\",\"quantity\":2}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cartId").value("40"))
                .andExpect(jsonPath("$.cartItemId").value("100")).andExpect(jsonPath("$.quantity").value(3));

        gateway.cart = new Cart("40", "ACTIVE", List.of(
                new CartItem("100", "250", "1984", "George Orwell", "PLG-LIT-001", null, 3,
                        new BigDecimal("19.90"), new BigDecimal("59.70"), true, null)),
                new BigDecimal("59.70"));
        String body = mvc.perform(get("/api/v1/cart").header("Authorization", customerToken("42")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cartId").value("40"))
                .andExpect(jsonPath("$.items[0].quantity").value(3))
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("\"cartId\":\"40\""));
        assertFalse(body.contains("\"cartId\":40"));
        assertEquals(List.of("add", "add", "get"), gateway.calls);
        assertEquals(250L, gateway.lastEditionId);
    }

    @Test
    void currentPricesSubtotalsAndTotalUseExactDecimalStringsAndUnavailableItemsRemainVisible() throws Exception {
        gateway.cart = new Cart("40", "ACTIVE", List.of(
                new CartItem("100", "250", "1984", "George Orwell", "PLG-LIT-001", null, 2,
                        new BigDecimal("19.90"), new BigDecimal("39.80"), true, null),
                new CartItem("101", "251", "Animal Farm", "George Orwell", "PLG-LIT-002", null, 1,
                        new BigDecimal("12.35"), new BigDecimal("12.35"), false, "EDITION_INACTIVE")),
                new BigDecimal("52.15"));

        String body = mvc.perform(get("/api/v1/cart").header("Authorization", customerToken("42")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cartId").value("40"))
                .andExpect(jsonPath("$.items[0].cartItemId").value("100"))
                .andExpect(jsonPath("$.items[0].editionId").value("250"))
                .andExpect(jsonPath("$.items[0].quantity").value(2))
                .andExpect(jsonPath("$.items[0].currentPrice").value("19.90"))
                .andExpect(jsonPath("$.items[0].currentSubtotal").value("39.80"))
                .andExpect(jsonPath("$.items[1].available").value(false))
                .andExpect(jsonPath("$.items[1].unavailabilityReason").value("EDITION_INACTIVE"))
                .andExpect(jsonPath("$.totalCurrent").value("52.15"))
                .andReturn().getResponse().getContentAsString();

        assertTrue(body.contains("\"editionId\":\"250\""));
        assertFalse(body.contains("\"editionId\":250"));
    }

    @Test
    void missingOrForeignCartItemsReturnOneSafeNotFoundProblem() throws Exception {
        gateway.failure = databaseFailure("P4003");
        for (Endpoint endpoint : List.of(
                new Endpoint("PUT", "/api/v1/cart/items/987654", UPDATE_BODY),
                new Endpoint("DELETE", "/api/v1/cart/items/987654", null))) {
            String body = mvc.perform(endpoint.request().header("Authorization", customerToken("42")))
                    .andExpect(status().isNotFound())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                    .andExpect(jsonPath("$.code").value("P4003"))
                    .andExpect(jsonPath("$.title").value("Artículo del carrito no encontrado"))
                    .andExpect(jsonPath("$.detail")
                            .value("El artículo solicitado no existe o no está disponible en tu carrito."))
                    .andReturn().getResponse().getContentAsString();
            assertFalse(body.contains("private postgres"));
            assertFalse(body.contains("constraint"));
        }
    }

    @Test
    void invalidQuantityUsesDatabaseCodeAndSpanishFeedback() throws Exception {
        gateway.failure = databaseFailure("P4004");
        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"editionId\":\"250\",\"quantity\":0}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("P4004"))
                .andExpect(jsonPath("$.title").value("Cantidad inválida"))
                .andExpect(jsonPath("$.detail").value("La cantidad debe ser mayor que cero."));
        assertEquals(0, gateway.lastQuantity);
    }

    @Test
    void insufficientStockAndInactiveBookOrEditionReturnSafeConflicts() throws Exception {
        gateway.failure = databaseFailure("P3002");
        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADD_BODY))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P3002"))
                .andExpect(jsonPath("$.title").value("Existencias insuficientes"))
                .andExpect(jsonPath("$.detail")
                        .value("No hay existencias suficientes para la cantidad solicitada."));

        gateway.failure = databaseFailure("P2042");
        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADD_BODY))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P2042"))
                .andExpect(jsonPath("$.title").value("Edición no disponible"))
                .andExpect(jsonPath("$.detail").value("La edición seleccionada no está disponible actualmente."));

        gateway.failure = databaseFailure("P2043");
        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADD_BODY))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P2043"))
                .andExpect(jsonPath("$.title").value("Libro no disponible"))
                .andExpect(jsonPath("$.detail").value(
                        "El libro asociado a la edición seleccionada no está disponible actualmente."));
    }

    @Test
    void cartWithoutActiveStateReturnsSpanishConflictForUpdateAndDelete() throws Exception {
        gateway.failure = databaseFailure("P4001");
        mvc.perform(put("/api/v1/cart/items/100").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON).content(UPDATE_BODY))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P4001"))
                .andExpect(jsonPath("$.title").value("Carrito no disponible"))
                .andExpect(jsonPath("$.detail")
                        .value("No hay un carrito activo para realizar esta operación."));
    }

    @Test
    void actorIdentityComesOnlyFromVerifiedJwtAndRequestCannotSetOwnership() throws Exception {
        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"editionId\":\"250\",\"quantity\":1,\"userId\":\"7\",\"customerId\":\"9\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MALFORMED_JSON"));
        assertTrue(gateway.calls.isEmpty());

        mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"editionId\":\"250\",\"quantity\":1}"))
                .andExpect(status().isOk());
        assertEquals(42L, gateway.lastActorId);
    }

    @Test
    void invalidEditionIdentifiersAndMissingQuantitiesAreRejectedBeforeTheGateway() throws Exception {
        for (String id : List.of("0", "-1", "9223372036854775808", "not-an-id")) {
            mvc.perform(post("/api/v1/cart/items").header("Authorization", customerToken("42"))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"editionId\":\"" + id + "\",\"quantity\":1}"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        mvc.perform(put("/api/v1/cart/items/100").header("Authorization", customerToken("42"))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertTrue(gateway.calls.isEmpty());
    }

    private DatabaseException databaseFailure(String state) {
        return exceptionTranslator.translate(new SQLException("private postgres SQL and constraint detail", state));
    }

    private String adminToken(String actor) { return token(actor, "ADMIN"); }
    private String customerToken(String actor) { return token(actor, "CUSTOMER"); }

    private String token(String actor, String role) {
        Instant issued = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(actor, role, issued, issued.plusSeconds(1800),
                UUID.randomUUID().toString());
    }

    private record Endpoint(String method, String path, String body) {
        MockHttpServletRequestBuilder request() {
            MockHttpServletRequestBuilder request = switch (method) {
                case "POST" -> post(path);
                case "PUT" -> put(path);
                case "DELETE" -> delete(path);
                default -> get(path);
            };
            if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(body);
            return request;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestConfigurationForCart {
        @Bean PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) { return new SimpleTransactionStatus(); }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }

        @Bean @Primary FakeCartGateway cartGateway() {
            return new FakeCartGateway();
        }
    }

    static class FakeCartGateway implements CartGateway {
        private final List<String> calls = new ArrayList<>();
        private DatabaseException failure;
        private long lastActorId;
        private long lastEditionId;
        private long lastCartItemId;
        private int lastQuantity;
        private Cart cart = new Cart(null, null, List.of(), new BigDecimal("0.00"));
        private CartItemResult nextResult = new CartItemResult("40", "100", 2);

        void reset() {
            calls.clear();
            failure = null;
            lastActorId = 0;
            lastEditionId = 0;
            lastCartItemId = 0;
            lastQuantity = -1;
            cart = new Cart(null, null, List.of(), new BigDecimal("0.00"));
            nextResult = new CartItemResult("40", "100", 2);
        }

        private void called(String operation, long actorId) {
            calls.add(operation);
            lastActorId = actorId;
        }

        private void failIfNeeded() {
            if (failure != null) throw failure;
        }

        @Override public Cart get(long actorId) {
            called("get", actorId);
            failIfNeeded();
            return cart;
        }

        @Override public CartItemResult addItem(long actorId, long editionId, int quantity) {
            called("add", actorId);
            lastEditionId = editionId;
            lastQuantity = quantity;
            failIfNeeded();
            return nextResult;
        }

        @Override public CartItemResult updateItem(long actorId, long cartItemId, int quantity) {
            called("update", actorId);
            lastCartItemId = cartItemId;
            lastQuantity = quantity;
            failIfNeeded();
            return nextResult;
        }

        @Override public void removeItem(long actorId, long cartItemId) {
            called("remove", actorId);
            lastCartItemId = cartItemId;
            failIfNeeded();
        }
    }
}
