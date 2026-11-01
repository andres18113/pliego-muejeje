package com.pliego.modules.sales.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.SQLException;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.sales.application.PickupService;
import com.pliego.modules.sales.application.PickupModels;

@SpringBootTest(properties = {
        "pliego.mail.enabled=false", "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_pickup_test",
        "spring.datasource.username=pliego_test", "spring.datasource.password=pliego_test", "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com", "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef", "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
class AdminPickupApiIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer tokens;
    @Autowired DatabaseExceptionTranslator errors;
    @MockitoBean PickupService service;

    @Test
    // AC-2.2 AC-2.3 AC-2.4
    void openApiKeepsAdministrativeOrderItemsDistinctFromPickupItemsAndMarksNullableIdentities() throws Exception {
        String body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        var schemas = new tools.jackson.databind.ObjectMapper().readTree(body).path("components").path("schemas");
        String orderItemRef = schemas.path("AdminOrderDetail").path("properties").path("items").path("items").path("$ref").asText();
        assertThat(orderItemRef).isEqualTo("#/components/schemas/Item");
        var orderProperties = schemas.path("Item").path("properties");
        for (String field : List.of("authors", "editionId", "isbn", "language", "publisher", "sku", "subtotal", "unitPrice")) {
            assertThat(orderProperties.has(field)).as("Existing administrative item field %s", field).isTrue();
        }
        var pickup = schemas.path("PickupView").path("properties");
        assertThat(pickup.path("items").path("items").path("$ref").asText())
                .isEqualTo("#/components/schemas/AdminPickupItem");
        assertThat(pickup.path("customer").path("$ref").asText())
                .isEqualTo("#/components/schemas/AdminPickupCustomer");
        assertThat(pickup.path("location").path("$ref").asText())
                .isEqualTo("#/components/schemas/AdminPickupLocation");
        var detail = schemas.path("AdminPickupDetail").path("properties");
        for (String field : List.of("orderId", "orderReference", "state", "orderState", "paymentState", "createdAt",
                "readyAt", "collectedAt", "collectedBy", "identityVerified", "location", "customer", "items", "unitCount", "total")) {
            assertThat(detail.has(field)).as("Detail preserves PickupView field %s", field).isTrue();
        }
        assertThat(detail.has("pickupCode")).isFalse();
        assertThat(detail.path("paymentMethod").path("type").toString()).contains("string", "null");
        assertThat(detail.path("availableActions").path("$ref").asText()).isEqualTo("#/components/schemas/AdminPickupAvailableActions");
        var customer = schemas.path("AdminPickupCustomer").path("properties");
        for (String field : List.of("identityType", "identityNumber")) {
            assertThat(customer.path(field).path("type").toString()).contains("string", "null");
        }
        assertThat(pickup.path("collectedBy").path("type").toString()).contains("object", "null");
        assertThat(schemas.path("Request").path("properties").path("decidedByEmail")
                .path("type").toString()).contains("string", "null");
    }

    @Test
    // AC-4.3
    void collectionRequiresAnExplicitVerifiedIdentityAndNonblankBoundedCode() throws Exception {
        for (String body : List.of("{\"pickupCode\":\"P-AB234567\"}",
                "{\"pickupCode\":\"P-AB234567\",\"identityVerified\":false}",
                "{\"pickupCode\":\" \",\"identityVerified\":true}",
                "{\"identityVerified\":true}",
                "{\"pickupCode\":null,\"identityVerified\":true}",
                "{\"pickupCode\":\"" + "A".repeat(65) + "\",\"identityVerified\":true}")) {
            mvc.perform(post("/api/v1/admin/orders/700/pickup/collect").header("Authorization", token("ADMIN"))
                    .contentType("application/json").content(body)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
    }

    @Test
    // AC-3.2
    void collectionAllowsNormalizedCodeVariantsAndLegacyLengthsToReachTheDatabaseBoundary() throws Exception {
        for (String code : List.of("P-AB234567", "p-ab234567", "AB234567", "ab234567", "PAB234567",
                " P - aB23 - 4567 ", "P-AB2345", "ab2345", "p-ab23456")) {
            when(service.collect(7L, 700L, code, true)).thenReturn(pickup());
            String body = new tools.jackson.databind.ObjectMapper().writeValueAsString(
                    java.util.Map.of("pickupCode", code, "identityVerified", true));
            mvc.perform(post("/api/v1/admin/orders/700/pickup/collect")
                    .header("Authorization", token("ADMIN")).contentType("application/json").content(body))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.orderReference").value("PL-0123-4567"));
        }
    }

    @Test
    // AC-3.2
    void collectionKeepsTheDatabaseWrongCodeErrorForNonmatchingCodes() throws Exception {
        when(service.collect(7L, 700L, "incorrecto", true))
                .thenThrow(errors.translate(new SQLException("private code", "P5013")));
        mvc.perform(post("/api/v1/admin/orders/700/pickup/collect")
                .header("Authorization", token("ADMIN")).contentType("application/json")
                .content("{\"pickupCode\":\"incorrecto\",\"identityVerified\":true}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("P5013"))
                .andExpect(jsonPath("$.detail").value("El código de retiro no corresponde al pedido."));
    }

    @Test
    // AC-7.1
    void everyPickupRouteRequiresAnAdminRole() throws Exception {
        for (var request : List.of(get("/api/v1/admin/pickups"),
                get("/api/v1/admin/pickups/700"),
                post("/api/v1/admin/pickups/700/verify-code").contentType("application/json").content("{\"code\":\"P-AB234567\"}"),
                post("/api/v1/admin/orders/700/cancel"),
                post("/api/v1/admin/pickups/lookup").contentType("application/json").content("{\"code\":\"P-AB234567\"}"),
                post("/api/v1/admin/orders/700/pickup/collect").contentType("application/json")
                        .content("{\"pickupCode\":\"P-AB234567\",\"identityVerified\":true}"))) {
            mvc.perform(request).andExpect(status().isUnauthorized());
            mvc.perform(request.header("Authorization", token("CUSTOMER"))).andExpect(status().isForbidden());
        }
    }

    @Test
    // AC-2.5 AC-3.2
    void pickupSearchAndLookupRejectInvalidInput() throws Exception {
        for (String query : List.of("?state=SHIPPED", "?page=-1", "?pageSize=51", "?pageSize=0")) {
            mvc.perform(get("/api/v1/admin/pickups" + query).header("Authorization", token("ADMIN")))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/v1/admin/pickups/lookup").header("Authorization", token("ADMIN"))
                .contentType("application/json").content("{\"code\":\" \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    // AC-2.1 AC-2.2 AC-2.3 AC-2.4
    void lookupCollectionAndPagesExposeCodeFreePickupViewsWithStringIdsAndMoney() throws Exception {
        var pickup = pickup();
        when(service.lookup(7L, "p-ab234567")).thenReturn(pickup);
        String lookup = mvc.perform(post("/api/v1/admin/pickups/lookup").header("Authorization", token("ADMIN"))
                .contentType("application/json").content("{\"code\":\"p-ab234567\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.orderReference").value("PL-0123-4567"))
                .andExpect(jsonPath("$.orderId").value("9007199254740993"))
                .andExpect(jsonPath("$.total").value("39.80"))
                .andExpect(jsonPath("$.readyAt").value("2026-11-01T15:00:00Z"))
                .andExpect(jsonPath("$.customer.identityNumber").value("0000000018"))
                .andExpect(jsonPath("$.items[0].quantity").value(2))
                .andExpect(jsonPath("$.unitCount").value(2))
                .andReturn().getResponse().getContentAsString();
        assertThat(lookup).doesNotContain("pickupCode", "AB234567", "\"code\"");
        when(service.collect(7L, 700L, "P-AB234567", true)).thenReturn(pickup);
        String collected = mvc.perform(post("/api/v1/admin/orders/700/pickup/collect")
                .header("Authorization", token("ADMIN")).contentType("application/json")
                .content("{\"pickupCode\":\"P-AB234567\",\"identityVerified\":true}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.identityVerified").value(true))
                .andExpect(jsonPath("$.collectedBy.userId").value("7"))
                .andExpect(jsonPath("$.collectedBy.email").value("admin@example.test"))
                .andReturn().getResponse().getContentAsString();
        assertThat(collected).doesNotContain("pickupCode", "AB234567");
        when(service.search(eq(7L), any())).thenReturn(new PickupModels.Page(List.of(pickup), 9007199254740993L));
        mvc.perform(get("/api/v1/admin/pickups").param("state", "COLLECTED").param("q", "#pl01234567")
                .header("Authorization", token("ADMIN"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCount").value("9007199254740993"))
                .andExpect(jsonPath("$.pageSize").value(20))
                .andExpect(jsonPath("$.items[0].orderReference").value("PL-0123-4567"))
                .andExpect(jsonPath("$.items[0].pickupCode").doesNotExist());
    }

    @Test
    void newPickupErrorsUseStableSpanishFeedbackAndNeverExposeTheLookupCode() throws Exception {
        for (String[] failure : new String[][]{
                {"P5016", "404", "No encontramos un retiro con ese código."},
                {"P5017", "409", "Este pedido ya fue retirado."},
                {"P5018", "409", "Este pedido aún no está listo para retiro."}}) {
            when(service.lookup(7L, "P-AB234567"))
                    .thenThrow(errors.translate(new SQLException("private P-AB234567", failure[0])));
            String response = mvc.perform(post("/api/v1/admin/pickups/lookup")
                    .header("Authorization", token("ADMIN")).contentType("application/json")
                    .content("{\"code\":\"P-AB234567\"}"))
                    .andExpect(status().is(Integer.parseInt(failure[1])))
                    .andExpect(jsonPath("$.code").value(failure[0]))
                    .andExpect(jsonPath("$.detail").value(failure[2]))
                    .andReturn().getResponse().getContentAsString();
            assertThat(response).doesNotContain("private", "AB234567");
            org.mockito.Mockito.reset(service);
        }
    }

    @Test
    // AC-2.1 AC-2.2 AC-2.3 AC-2.4 AC-8.1
    void detailAndVerifiedCodeReturnTheSameAdditiveCodeFreeContract() throws Exception {
        var view = pickup();
        var detail = new PickupModels.Detail(view.orderId(), view.orderReference(), view.state(), view.orderState(),
                view.paymentState(), view.createdAt(), view.readyAt(), view.collectedAt(), view.collectedBy(),
                view.identityVerified(), view.location(), view.customer(), view.items(), view.unitCount(), view.total(),
                "TRANSFER", new PickupModels.AvailableActions(true, "2026-11-01T10:06:00-05:00"));
        when(service.detail(7L, 700L)).thenReturn(detail);
        when(service.verifyCode(7L, 700L, "p-ab234567")).thenReturn(detail);
        for (var request : List.of(get("/api/v1/admin/pickups/700"),
                post("/api/v1/admin/pickups/700/verify-code").contentType("application/json").content("{\"code\":\"p-ab234567\"}"))) {
            var response = mvc.perform(request.header("Authorization", token("ADMIN")))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.paymentMethod").value("TRANSFER"))
                    .andExpect(jsonPath("$.availableActions.cancel").value(true))
                    .andExpect(jsonPath("$.availableActions.cancellationDeadline").value("2026-11-01T15:06:00Z"))
                    .andExpect(jsonPath("$.orderId").value(view.orderId()))
                    .andReturn().getResponse().getContentAsString();
            assertThat(response).doesNotContain("pickupCode", "ab234567", "AB234567");
        }
    }

    @Test
    // AC-2.5 AC-3.2
    void detailAndVerificationPreserveNotFoundAndInvalidCodeErrors() throws Exception {
        when(service.detail(7L, 700L)).thenThrow(errors.translate(new SQLException("private", "P5016")));
        mvc.perform(get("/api/v1/admin/pickups/700").header("Authorization", token("ADMIN")))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("P5016"));
        for (String code : List.of("wrong", "another-orders-code", "unknown-order")) {
            String sqlState = code.equals("unknown-order") ? "P5016" : "P5013";
            when(service.verifyCode(7L, 700L, code)).thenThrow(errors.translate(new SQLException("private", sqlState)));
            mvc.perform(post("/api/v1/admin/pickups/700/verify-code").header("Authorization", token("ADMIN"))
                    .contentType("application/json").content("{\"code\":\"" + code + "\"}"))
                    .andExpect(status().is(sqlState.equals("P5016") ? 404 : 400)).andExpect(jsonPath("$.code").value(sqlState));
        }
    }

    @Test
    // AC-6.2 AC-6.3
    void collectionPreservesConflictCodes() throws Exception {
        for (String code : List.of("P5017", "P5018", "P5002")) {
            org.mockito.Mockito.doThrow(errors.translate(new SQLException("private", code)))
                    .when(service).collect(7L, 700L, "P-AB234567", true);
            mvc.perform(post("/api/v1/admin/orders/700/pickup/collect").header("Authorization", token("ADMIN"))
                    .contentType("application/json").content("{\"pickupCode\":\"P-AB234567\",\"identityVerified\":true}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value(code));
        }
    }

    private static PickupModels.View pickup() {
        return new PickupModels.View("9007199254740993", "PL-0123-4567", "COLLECTED", "DELIVERED", "APPROVED",
                "2026-11-01T09:00:00-05:00", "2026-11-01T10:00:00-05:00", "2026-11-01T15:05:00Z",
                new PickupModels.CollectedBy("7", "admin@example.test"), true,
                new PickupModels.Location("1", "Centro", "Av. Principal", "Quito"),
                new PickupModels.Customer("42", "Ana", "ana@example.test", "EC_CEDULA", "0000000018"),
                List.of(new PickupModels.Item("800", "Título impreso", "PAPERBACK", 2)), 2, new java.math.BigDecimal("39.8"));
    }

    private String token(String role) {
        var now = java.time.Instant.now();
        return "Bearer " + tokens.issue("7", role, now, now.plusSeconds(1800), java.util.UUID.randomUUID().toString());
    }
}
