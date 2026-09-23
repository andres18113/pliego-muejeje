package com.pliego.modules.inventory.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import com.pliego.modules.inventory.application.InventoryModels.Adjustment;
import com.pliego.modules.inventory.application.InventoryModels.Entry;
import com.pliego.modules.inventory.application.InventoryModels.InventoryItem;
import com.pliego.modules.inventory.application.InventoryModels.Movement;
import com.pliego.modules.inventory.application.InventoryModels.MovementResult;
import com.pliego.modules.inventory.application.InventoryModels.MovementSearch;
import com.pliego.modules.inventory.application.InventoryModels.Page;
import com.pliego.modules.inventory.application.InventoryModels.Search;
import com.pliego.modules.inventory.gateway.InventoryGateway;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i6_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(AdminInventoryApiIntegrationTest.TestConfigurationForInventory.class)
class AdminInventoryApiIntegrationTest {

    private static final String ENTRY_BODY = "{\"quantity\":20,\"reason\":\"Ingreso de inventario\"}";
    private static final String ADJUSTMENT_BODY = "{\"type\":\"ADJUSTMENT_OUT\",\"quantity\":2,\"reason\":\"Corrección de conteo físico\"}";
    private static final String MINIMUM_BODY = "{\"stockMinimum\":5}";

    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer tokenIssuer;
    @Autowired DatabaseExceptionTranslator exceptionTranslator;
    @Autowired FakeInventoryGateway gateway;

    @BeforeEach
    void resetGateway() {
        gateway.reset();
    }

    @Test
    void allEndpointsRequireAdminAndSearchUsesDefaultPagination() throws Exception {
        String admin = adminToken("17");
        mvc.perform(get("/api/v1/admin/inventory").header("Authorization", admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.pageSize").value(20)).andExpect(jsonPath("$.totalCount").value("0"));
        mvc.perform(get("/api/v1/admin/inventory/250/movements").header("Authorization", admin))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/admin/inventory/250/entries").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content(ENTRY_BODY))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/v1/admin/inventory/250/adjustments").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content(ADJUSTMENT_BODY))
                .andExpect(status().isCreated());
        mvc.perform(put("/api/v1/admin/inventory/250/minimum").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content(MINIMUM_BODY))
                .andExpect(status().isNoContent());

        int allowedCalls = gateway.callCount;
        for (Endpoint endpoint : List.of(
                new Endpoint("GET", "/api/v1/admin/inventory", null),
                new Endpoint("GET", "/api/v1/admin/inventory/250/movements", null),
                new Endpoint("POST", "/api/v1/admin/inventory/250/entries", ENTRY_BODY),
                new Endpoint("POST", "/api/v1/admin/inventory/250/adjustments", ADJUSTMENT_BODY),
                new Endpoint("PUT", "/api/v1/admin/inventory/250/minimum", MINIMUM_BODY))) {
            mvc.perform(endpoint.request().header("Authorization", customerToken("42"))).andExpect(status().isForbidden());
            mvc.perform(endpoint.request()).andExpect(status().isUnauthorized());
        }
        assertEquals(allowedCalls, gateway.callCount);
        assertEquals(17L, gateway.lastActorId);
    }

    @Test
    void searchPassesEditionTitleSkuLowStockAndPaginationFilters() throws Exception {
        gateway.searchPage = new Page<>(List.of(new InventoryItem("250", "90", "1984", "PLG-LIT-001",
                "9780306406157", "ACTIVE", 5, 5, true, "2026-09-23T19:30:00Z")), 17);
        mvc.perform(get("/api/v1/admin/inventory").header("Authorization", adminToken("17"))
                        .param("editionId", "250").param("title", "1984").param("sku", "PLG-LIT-001")
                        .param("lowStockOnly", "true").param("page", "2").param("pageSize", "7"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].editionId").value("250"))
                .andExpect(jsonPath("$.items[0].bookId").value("90"))
                .andExpect(jsonPath("$.items[0].stockActual").value(5))
                .andExpect(jsonPath("$.items[0].stockMinimum").value(5))
                .andExpect(jsonPath("$.items[0].lowStock").value(true))
                .andExpect(jsonPath("$.items[0].updatedAt").value("2026-09-23T19:30:00Z"))
                .andExpect(jsonPath("$.page").value(2)).andExpect(jsonPath("$.pageSize").value(7))
                .andExpect(jsonPath("$.totalCount").value("17"));
        assertEquals(new Search(250L, "1984", "PLG-LIT-001", true, 2, 7), gateway.lastSearch);
    }

    @Test
    void zeroMinimumHasNoLowStockThreshold() throws Exception {
        gateway.searchPage = new Page<>(List.of(new InventoryItem("250", "90", "1984", "PLG-LIT-001",
                "9780306406157", "ACTIVE", 0, 0, false, "2026-09-23T19:30:00Z")), 1);
        mvc.perform(get("/api/v1/admin/inventory").header("Authorization", adminToken("17")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].stockActual").value(0))
                .andExpect(jsonPath("$.items[0].stockMinimum").value(0))
                .andExpect(jsonPath("$.items[0].lowStock").value(false));
    }

    @Test
    void movementHistoryPassesFilterAndPaginationAndSerializesIdentifiersAsStrings() throws Exception {
        gateway.movementPage = new Page<>(List.of(new Movement("900", "250", "700", null, "SALE", 2, 8, 6,
                null, "2026-09-23T19:30:00Z")), 23);
        String body = mvc.perform(get("/api/v1/admin/inventory/250/movements").header("Authorization", adminToken("17"))
                        .param("type", "SALE").param("page", "3").param("pageSize", "4"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].movementId").value("900"))
                .andExpect(jsonPath("$.items[0].editionId").value("250"))
                .andExpect(jsonPath("$.items[0].orderId").value("700"))
                .andExpect(jsonPath("$.items[0].actorUserId").doesNotExist())
                .andExpect(jsonPath("$.items[0].quantity").value(2))
                .andExpect(jsonPath("$.items[0].stockBefore").value(8))
                .andExpect(jsonPath("$.items[0].stockAfter").value(6))
                .andExpect(jsonPath("$.items[0].eventAt").value("2026-09-23T19:30:00Z"))
                .andExpect(jsonPath("$.totalCount").value("23"))
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("\"movementId\":\"900\""));
        assertFalse(body.contains("\"movementId\":900"));
        assertEquals(new MovementSearch(250, "SALE", 3, 4), gateway.lastMovementSearch);
    }

    @Test
    void entryReturnsProcedureMovementAndStockValues() throws Exception {
        gateway.nextResult = new MovementResult("450", 12, 32);
        mvc.perform(post("/api/v1/admin/inventory/250/entries").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(ENTRY_BODY))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.movementId").value("450"))
                .andExpect(jsonPath("$.stockBefore").value(12)).andExpect(jsonPath("$.stockAfter").value(32));
        assertEquals(20, gateway.lastEntry.quantity());
        assertEquals("Ingreso de inventario", gateway.lastEntry.reason());
        assertEquals(250L, gateway.lastEditionId);
    }

    @Test
    void adjustmentInAndOutReturnTheProcedureResults() throws Exception {
        gateway.nextResult = new MovementResult("451", 32, 35);
        mvc.perform(post("/api/v1/admin/inventory/250/adjustments").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"ADJUSTMENT_IN\",\"quantity\":3,\"reason\":\"Conteo\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.movementId").value("451"))
                .andExpect(jsonPath("$.stockBefore").value(32)).andExpect(jsonPath("$.stockAfter").value(35));
        assertEquals(new Adjustment("ADJUSTMENT_IN", 3, "Conteo"), gateway.lastAdjustment);

        gateway.nextResult = new MovementResult("452", 35, 33);
        mvc.perform(post("/api/v1/admin/inventory/250/adjustments").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADJUSTMENT_BODY))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.movementId").value("452"))
                .andExpect(jsonPath("$.stockBefore").value(35)).andExpect(jsonPath("$.stockAfter").value(33));
        assertEquals(new Adjustment("ADJUSTMENT_OUT", 2, "Corrección de conteo físico"), gateway.lastAdjustment);
    }

    @Test
    void insufficientStockReturnsSafeConflict() throws Exception {
        gateway.failure = databaseFailure("P3002");
        String body = mvc.perform(post("/api/v1/admin/inventory/250/adjustments").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADJUSTMENT_BODY))
                .andExpect(status().isConflict()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("P3002"))
                .andExpect(jsonPath("$.title").value("Existencias insuficientes"))
                .andExpect(jsonPath("$.detail").value("No hay existencias suficientes para realizar el ajuste."))
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("private postgres"));
    }

    @Test
    void inventoryRoutineErrorsUseTheApprovedSpanishFeedback() throws Exception {
        gateway.failure = databaseFailure("P3003");
        mvc.perform(post("/api/v1/admin/inventory/250/entries").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(ENTRY_BODY))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("P3003"))
                .andExpect(jsonPath("$.title").value("Cantidad inválida"))
                .andExpect(jsonPath("$.detail").value("La cantidad debe ser mayor que cero."));

        gateway.failure = databaseFailure("P3004");
        mvc.perform(put("/api/v1/admin/inventory/250/minimum").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content(MINIMUM_BODY))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("P3004"))
                .andExpect(jsonPath("$.title").value("Mínimo de existencias inválido"))
                .andExpect(jsonPath("$.detail").value("El stock mínimo no puede ser negativo."));
    }

    @Test
    void invalidQuantitiesAreRejectedInSpanishWithoutCallingDatabase() throws Exception {
        for (String body : List.of("{\"quantity\":0,\"reason\":\"Ajuste\"}",
                "{\"quantity\":-1,\"reason\":\"Ajuste\"}")) {
            mvc.perform(post("/api/v1/admin/inventory/250/entries").header("Authorization", adminToken("17"))
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.violations[0].message").value("La cantidad debe ser mayor que cero."));
        }
        mvc.perform(put("/api/v1/admin/inventory/250/minimum").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"stockMinimum\":-1}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.violations[0].message")
                        .value("El stock mínimo no puede ser negativo."));
        assertEquals(0, gateway.callCount);
    }

    @Test
    void invalidAdjustmentTypesIncludingSystemOwnedMovementsCannotReachProcedure() throws Exception {
        for (String type : List.of("INVALID", "SALE", "CANCELLATION")) {
            mvc.perform(post("/api/v1/admin/inventory/250/adjustments").header("Authorization", adminToken("17"))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"" + type + "\",\"quantity\":1,\"reason\":\"Ajuste\"}"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.violations[0].message")
                            .value("El tipo de ajuste debe ser ADJUSTMENT_IN o ADJUSTMENT_OUT."));
        }
        assertEquals(0, gateway.callCount);
    }

    @Test
    void minimumMayBeZeroAndSettingTheSameValueRemainsValidAndIdempotent() throws Exception {
        String admin = adminToken("17");
        for (String body : List.of(MINIMUM_BODY, MINIMUM_BODY, "{\"stockMinimum\":0}")) {
            mvc.perform(put("/api/v1/admin/inventory/250/minimum").header("Authorization", admin)
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isNoContent()).andExpect(content().string(""));
        }
        assertEquals(3, gateway.minimumCalls);
        assertEquals(0, gateway.lastMinimum);
    }

    @Test
    void missingInventoryReturnsSafeNotFound() throws Exception {
        gateway.failure = databaseFailure("P3001");
        String body = mvc.perform(get("/api/v1/admin/inventory/250/movements")
                        .header("Authorization", adminToken("17")))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("P3001"))
                .andExpect(jsonPath("$.title").value("Inventario no encontrado"))
                .andExpect(jsonPath("$.detail").value("No existe inventario para la edición solicitada."))
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("private postgres"));
    }

    @Test
    void invalidFiltersAndPaginationHaveSpanishValidationFeedback() throws Exception {
        mvc.perform(get("/api/v1/admin/inventory").header("Authorization", adminToken("17"))
                        .param("editionId", "0"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.detail")
                        .value("Revisa los filtros enviados e intenta nuevamente."));
        mvc.perform(get("/api/v1/admin/inventory/250/movements").header("Authorization", adminToken("17"))
                        .param("pageSize", "51"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertEquals(0, gateway.callCount);
    }

    private DatabaseException databaseFailure(String state) {
        return exceptionTranslator.translate(new SQLException("private postgres SQL and constraint detail", state));
    }

    private String adminToken(String actor) { return token(actor, "ADMIN"); }
    private String customerToken(String actor) { return token(actor, "CUSTOMER"); }
    private String token(String actor, String role) {
        Instant issued = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(actor, role, issued, issued.plusSeconds(1800), UUID.randomUUID().toString());
    }

    private record Endpoint(String method, String path, String body) {
        MockHttpServletRequestBuilder request() {
            MockHttpServletRequestBuilder request = switch (method) {
                case "POST" -> post(path);
                case "PUT" -> put(path);
                default -> get(path);
            };
            if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(body);
            return request;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestConfigurationForInventory {
        @Bean PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) { return new SimpleTransactionStatus(); }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }
        @Bean @Primary FakeInventoryGateway inventoryGateway(DatabaseExceptionTranslator translator) {
            return new FakeInventoryGateway();
        }
    }

    static class FakeInventoryGateway implements InventoryGateway {
        private DatabaseException failure;
        private int callCount;
        private int minimumCalls;
        private long lastActorId;
        private long lastEditionId;
        private int lastMinimum;
        private Search lastSearch;
        private MovementSearch lastMovementSearch;
        private Entry lastEntry;
        private Adjustment lastAdjustment;
        private MovementResult nextResult = new MovementResult("450", 12, 32);
        private Page<InventoryItem> searchPage = new Page<>(List.of(), 0);
        private Page<Movement> movementPage = new Page<>(List.of(), 0);

        void reset() {
            failure = null;
            callCount = 0;
            minimumCalls = 0;
            lastActorId = 0;
            lastEditionId = 0;
            lastMinimum = -1;
            lastSearch = null;
            lastMovementSearch = null;
            lastEntry = null;
            lastAdjustment = null;
            nextResult = new MovementResult("450", 12, 32);
            searchPage = new Page<>(List.of(), 0);
            movementPage = new Page<>(List.of(), 0);
        }

        private void called(long actorId) {
            callCount++;
            lastActorId = actorId;
            if (failure != null) throw failure;
        }

        @Override public Page<InventoryItem> search(long actorId, Search query) {
            called(actorId);
            lastSearch = query;
            return searchPage;
        }
        @Override public Page<Movement> movements(long actorId, MovementSearch query) {
            called(actorId);
            lastMovementSearch = query;
            lastEditionId = query.editionId();
            return movementPage;
        }
        @Override public MovementResult entry(long actorId, long editionId, Entry request) {
            called(actorId);
            lastEditionId = editionId;
            lastEntry = request;
            return nextResult;
        }
        @Override public MovementResult adjust(long actorId, long editionId, Adjustment request) {
            called(actorId);
            lastEditionId = editionId;
            lastAdjustment = request;
            return nextResult;
        }
        @Override public void setMinimum(long actorId, long editionId, int stockMinimum) {
            called(actorId);
            lastEditionId = editionId;
            lastMinimum = stockMinimum;
            minimumCalls++;
        }
    }
}
