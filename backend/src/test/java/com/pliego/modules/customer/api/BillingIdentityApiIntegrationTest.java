package com.pliego.modules.customer.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.http.MediaType;

class BillingIdentityApiIntegrationTest extends CustomerApiIntegrationTest {
    @MockitoBean com.pliego.modules.customer.gateway.BillingIdentityGateway billingGateway;

    private String auth(long actor) {
        var now = java.time.Instant.now();
        return "Bearer " + tokenIssuer.issue(Long.toString(actor), "CUSTOMER", now, now.plusSeconds(1800), java.util.UUID.randomUUID().toString());
    }

    @Test
    void authenticatedOwnerCanReadWriteAndExplicitlyRemoveIdentity() throws Exception {
        String token = auth(10);
        mvc.perform(get("/api/v1/me/billing-identity").header("Authorization", token))
                .andExpect(status().isNoContent()).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"EC_CEDULA\",\"number\":\" 0012345674 \"}"))
                .andExpect(status().isNoContent());
        verify(billingGateway).set(10, "EC_CEDULA", "0012345674");
        when(billingGateway.find(10)).thenReturn(new com.pliego.modules.customer.application.BillingIdentity("EC_CEDULA", "0012345674"));
        mvc.perform(get("/api/v1/me/billing-identity").header("Authorization", token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.type").value("EC_CEDULA"))
                .andExpect(jsonPath("$.number").value("0012345674"))
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(delete("/api/v1/me/billing-identity").header("Authorization", token))
                .andExpect(status().isNoContent());
        verify(billingGateway).remove(10);
    }

    @Test
    void invalidOrUnsupportedIdentityNeverReachesGatewayAndDoesNotEchoNumber() throws Exception {
        for (String body : new String[]{"{}", "{\"type\":\"RUC\",\"number\":\"0012345674\"}",
                "{\"type\":\"EC_CEDULA\",\"number\":\"0000000000\"}",
                "{\"type\":\"EC_CEDULA\",\"number\":\"0012345675\"}"}) {
            mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", auth(10))
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("0012345675"))));
        }
        verifyNoInteractions(billingGateway);
    }

    @Test
    void noAnonymousAccessAndActorAlwaysComesFromAuthenticatedSubject() throws Exception {
        mvc.perform(get("/api/v1/me/billing-identity")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/v1/me/billing-identity").contentType(MediaType.APPLICATION_JSON)
                .content("{}" )).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/v1/me/billing-identity")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/me/billing-identity?actorUserId=10").header("Authorization", auth(20)))
                .andExpect(status().isNoContent());
        verify(billingGateway).find(20);
        verify(billingGateway, never()).find(10);
    }

    @Test
    void editingGeneralProfileWithoutIdentityNeverUpdatesOrRemovesIdentity() throws Exception {
        mvc.perform(put("/api/v1/me").header("Authorization", auth(100))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"expectedVersion\":\"0\",\"firstNames\":\"Ana\",\"lastNames\":\"Pérez\",\"phone\":null}"))
                .andExpect(status().isNoContent());
        verifyNoInteractions(billingGateway);
    }

    @Test
    void administratorsCannotUseCustomerIdentityEndpoints() throws Exception {
        var now = java.time.Instant.now();
        String token = "Bearer " + tokenIssuer.issue("30", "ADMIN", now, now.plusSeconds(1800), java.util.UUID.randomUUID().toString());
        mvc.perform(get("/api/v1/me/billing-identity").header("Authorization", token)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/me/billing-identity").header("Authorization", token)).andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"EC_CEDULA\",\"number\":\"0012345674\"}"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(billingGateway);
    }

    @Test
    void rejectsInjectedOwnerAndDoesNotExposeDatabaseErrors() throws Exception {
        mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", auth(10))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"EC_CEDULA\",\"number\":\"0012345674\",\"actorUserId\":20}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(billingGateway);
        when(billingGateway.find(10)).thenThrow(exceptionTranslator.translate(new java.sql.SQLException("0012345674 private SQL", "P1005")));
        mvc.perform(get("/api/v1/me/billing-identity").header("Authorization", auth(10)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("P1005"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("0012345674"))));
    }
}
