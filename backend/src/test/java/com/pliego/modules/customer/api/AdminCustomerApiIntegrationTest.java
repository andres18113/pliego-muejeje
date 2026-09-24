package com.pliego.modules.customer.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.SQLException;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.customer.application.AdminCustomerModels.CustomerSummary;
import com.pliego.modules.customer.application.AdminCustomerModels.Page;
import com.pliego.modules.customer.application.AdminCustomerModels.Search;
import com.pliego.modules.customer.gateway.AdminCustomerGateway;
import com.pliego.modules.customer.gateway.CustomerGateway;
import com.pliego.modules.customer.gateway.CustomerGateway.AddressData;
import com.pliego.modules.customer.gateway.CustomerGateway.CustomerAddress;
import com.pliego.modules.customer.gateway.CustomerGateway.CustomerProfile;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i11_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(AdminCustomerApiIntegrationTest.TestConfigurationForAdminCustomer.class)
class AdminCustomerApiIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer tokenIssuer;
    @Autowired DatabaseExceptionTranslator exceptionTranslator;
    @Autowired FakeAdminCustomerGateway adminGateway;
    @Autowired FakePrivateCustomerGateway customerGateway;

    @BeforeEach
    void resetGateways() {
        adminGateway.reset();
        customerGateway.reset();
    }

    @Test
    void bothEndpointsRequireAdminAndAdminSearchUsesDefaultPagination() throws Exception {
        mvc.perform(get("/api/v1/admin/customers").header("Authorization", adminToken("17")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.pageSize").value(20))
                .andExpect(jsonPath("$.totalCount").value("0"));
        assertEquals(new Search(null, null, 0, 20), adminGateway.lastSearch);
        assertEquals(17L, adminGateway.lastActorId);

        mvc.perform(get("/api/v1/admin/customers"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
        mvc.perform(get("/api/v1/admin/customers").header("Authorization", customerToken("700")))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        mvc.perform(put("/api/v1/admin/customers/87/status").header("Authorization", customerToken("700"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"state\":\"BLOCKED\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/admin/customers/87/status").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"state\":\"BLOCKED\"}"))
                .andExpect(status().isUnauthorized());
        assertEquals(1, adminGateway.searchCalls);
        assertEquals(0, adminGateway.statusCalls);
    }

    @Test
    void emptyAndPaginatedSearchesPreserveFiltersAndSerializeOnlyContractFields() throws Exception {
        String admin = adminToken("17");
        mvc.perform(get("/api/v1/admin/customers").header("Authorization", admin)
                        .param("query", "ana").param("state", "ACTIVE").param("page", "2").param("pageSize", "7"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.page").value(2))
                .andExpect(jsonPath("$.pageSize").value(7));
        assertEquals(new Search("ana", "ACTIVE", 2, 7), adminGateway.lastSearch);

        adminGateway.page = new Page(List.of(
                new CustomerSummary("87", "ana@example.com", "Ana María", "Pérez", null, "ACTIVE",
                        "2026-09-23T10:15:30Z")), 1);
        String json = mvc.perform(get("/api/v1/admin/customers").header("Authorization", admin)
                        .param("page", "0").param("pageSize", "5"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].customerId").value("87"))
                .andExpect(jsonPath("$.items[0].email").value("ana@example.com"))
                .andExpect(jsonPath("$.items[0].firstNames").value("Ana María"))
                .andExpect(jsonPath("$.items[0].lastNames").value("Pérez"))
                .andExpect(jsonPath("$.items[0].phone").doesNotExist())
                .andExpect(jsonPath("$.items[0].state").value("ACTIVE"))
                .andExpect(jsonPath("$.items[0].createdAt").value("2026-09-23T10:15:30Z"))
                .andExpect(jsonPath("$.totalCount").value("1"))
                .andReturn().getResponse().getContentAsString();
        assertTrue(json.contains("\"customerId\":\"87\""));
        assertFalse(json.contains("userId"));
        assertFalse(json.contains("password"));

        for (String state : List.of("ACTIVE", "BLOCKED")) {
            mvc.perform(get("/api/v1/admin/customers").header("Authorization", admin).param("state", state))
                    .andExpect(status().isOk());
            assertEquals(state, adminGateway.lastSearch.state());
        }
    }

    @Test
    void invalidFiltersAndStatusStatesReturnSpanishValidationProblems() throws Exception {
        mvc.perform(get("/api/v1/admin/customers").header("Authorization", adminToken("17"))
                        .param("state", "PENDING"))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith(
                        MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.title").value("Datos inválidos"))
                .andExpect(jsonPath("$.detail").value("Revisa los filtros enviados e intenta nuevamente."));
        mvc.perform(get("/api/v1/admin/customers").header("Authorization", adminToken("17"))
                        .param("page", "-1"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mvc.perform(put("/api/v1/admin/customers/87/status").header("Authorization", adminToken("17"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"state\":\"PENDING\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.title").value("Datos inválidos"))
                .andExpect(jsonPath("$.violations[0].message").value("El estado debe ser ACTIVE o BLOCKED."));
        assertEquals(0, adminGateway.searchCalls);
        assertEquals(0, adminGateway.statusCalls);
    }

    @Test
    void statusUsesJwtActorAndPathCustomerAndIsIdempotent() throws Exception {
        String admin = adminToken("17");
        mvc.perform(put("/api/v1/admin/customers/87/status").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"state\":\"BLOCKED\"}"))
                .andExpect(status().isNoContent());
        assertEquals(17L, adminGateway.lastActorId);
        assertEquals(87L, adminGateway.lastCustomerId);
        assertEquals("BLOCKED", adminGateway.lastState);
        assertEquals("BLOCKED", adminGateway.state(87));

        mvc.perform(put("/api/v1/admin/customers/87/status").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"state\":\"BLOCKED\"}"))
                .andExpect(status().isNoContent());
        assertEquals(2, adminGateway.statusCalls);
        assertEquals("BLOCKED", adminGateway.state(87));
        assertEquals(1, adminGateway.sameStateRequests);
    }

    @Test
    void nonexistentCustomerReturnsSafeSpanishNotFound() throws Exception {
        String response = mvc.perform(put("/api/v1/admin/customers/9223372036854775807/status")
                        .header("Authorization", adminToken("17")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"state\":\"BLOCKED\"}"))
                .andExpect(status().isNotFound()).andExpect(content().contentTypeCompatibleWith(
                        MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("P1102"))
                .andExpect(jsonPath("$.title").value("Cliente no encontrado"))
                .andExpect(jsonPath("$.detail").value("El cliente solicitado no está disponible."))
                .andReturn().getResponse().getContentAsString();
        assertFalse(response.contains("internal customer"));
        assertFalse(response.contains("pliego.cliente"));
    }

    @Test
    void existingCustomerJwtStopsAtDatabaseBoundaryWhenBlockedAndWorksAfterReactivation() throws Exception {
        String issuedBeforeBlock = customerToken("700");
        mvc.perform(get("/api/v1/me").header("Authorization", issuedBeforeBlock))
                .andExpect(status().isOk()).andExpect(jsonPath("$.customerId").value("87"));

        String admin = adminToken("17");
        mvc.perform(put("/api/v1/admin/customers/87/status").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"state\":\"BLOCKED\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/me").header("Authorization", issuedBeforeBlock))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("P1003"))
                .andExpect(jsonPath("$.title").value("Cuenta bloqueada"))
                .andExpect(jsonPath("$.detail").value("Tu cuenta está bloqueada y no puede realizar esta operación."));
        assertEquals(2, customerGateway.profileCalls);
        assertEquals(700L, customerGateway.lastActorUserId);

        mvc.perform(put("/api/v1/admin/customers/87/status").header("Authorization", admin)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"state\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/me").header("Authorization", issuedBeforeBlock))
                .andExpect(status().isOk()).andExpect(jsonPath("$.customerId").value("87"));
        assertEquals(3, customerGateway.profileCalls);
        assertEquals("ACTIVE", adminGateway.state(87));
    }

    private String adminToken(String subject) {
        Instant issuedAt = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(subject, "ADMIN", issuedAt,
                issuedAt.plusSeconds(1800), UUID.randomUUID().toString());
    }

    private String customerToken(String subject) {
        Instant issuedAt = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(subject, "CUSTOMER", issuedAt,
                issuedAt.plusSeconds(1800), UUID.randomUUID().toString());
    }

    @TestConfiguration
    static class TestConfigurationForAdminCustomer {
        @Bean
        PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) {
                    return new SimpleTransactionStatus();
                }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }

        @Bean @Primary
        FakeAdminCustomerGateway adminCustomerGateway(DatabaseExceptionTranslator translator) {
            return new FakeAdminCustomerGateway(translator);
        }

        @Bean @Primary
        FakePrivateCustomerGateway privateCustomerGateway(FakeAdminCustomerGateway adminGateway,
                DatabaseExceptionTranslator translator) {
            return new FakePrivateCustomerGateway(adminGateway, translator);
        }
    }

    static class FakeAdminCustomerGateway implements AdminCustomerGateway {
        private final DatabaseExceptionTranslator translator;
        private final Map<Long, String> states = new HashMap<>();
        private Page page = new Page(List.of(), 0);
        private Search lastSearch;
        private long lastActorId;
        private long lastCustomerId;
        private String lastState;
        private int searchCalls;
        private int statusCalls;
        private int sameStateRequests;

        FakeAdminCustomerGateway(DatabaseExceptionTranslator translator) {
            this.translator = translator;
            reset();
        }

        void reset() {
            states.clear();
            states.put(87L, "ACTIVE");
            states.put(91L, "BLOCKED");
            page = new Page(List.of(), 0);
            lastSearch = null;
            lastActorId = 0;
            lastCustomerId = 0;
            lastState = null;
            searchCalls = 0;
            statusCalls = 0;
            sameStateRequests = 0;
        }

        @Override public Page search(long actorUserId, Search search) {
            lastActorId = actorUserId;
            lastSearch = search;
            searchCalls++;
            return page;
        }

        @Override public void setStatus(long actorUserId, long customerId, String state) {
            lastActorId = actorUserId;
            lastCustomerId = customerId;
            lastState = state;
            statusCalls++;
            String current = states.get(customerId);
            if (current == null) throw translator.translate(new SQLException("internal customer lookup", "P1102"));
            if (current.equals(state)) sameStateRequests++;
            else states.put(customerId, state);
        }

        String state(long customerId) { return states.get(customerId); }
    }

    static class FakePrivateCustomerGateway implements CustomerGateway {
        private final FakeAdminCustomerGateway adminGateway;
        private final DatabaseExceptionTranslator translator;
        private long lastActorUserId;
        private int profileCalls;

        FakePrivateCustomerGateway(FakeAdminCustomerGateway adminGateway, DatabaseExceptionTranslator translator) {
            this.adminGateway = adminGateway;
            this.translator = translator;
        }

        void reset() { lastActorUserId = 0; profileCalls = 0; }

        @Override public CustomerProfile findProfile(long actorUserId) {
            lastActorUserId = actorUserId;
            profileCalls++;
            if (adminGateway.state(87) == null || "BLOCKED".equals(adminGateway.state(87))) {
                throw translator.translate(new SQLException("private internal blocked account", "P1003"));
            }
            return new CustomerProfile(87, "ana@example.com", "Ana", "Pérez", null, "ACTIVE");
        }

        @Override public void updateProfile(long actorUserId, String firstNames, String lastNames, String phone) { }
        @Override public List<CustomerAddress> listAddresses(long actorUserId) { return List.of(); }
        @Override public long createAddress(long actorUserId, AddressData address, boolean makePrimary) { return 1; }
        @Override public void updateAddress(long actorUserId, long addressId, AddressData address) { }
        @Override public void deleteAddress(long actorUserId, long addressId) { }
        @Override public void setPrimaryAddress(long actorUserId, long addressId) { }
    }
}
