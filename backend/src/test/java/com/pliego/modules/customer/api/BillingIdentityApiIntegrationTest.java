package com.pliego.modules.customer.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.http.MediaType;

class BillingIdentityApiIntegrationTest extends CustomerApiIntegrationTest {
    @MockitoBean com.pliego.modules.customer.gateway.BillingIdentityGateway billingGateway;

    private String auth(long actor) {
        var now = java.time.Instant.now();
        return "Bearer " + tokenIssuer.issue(Long.toString(actor), "CUSTOMER", now, now.plusSeconds(1800), java.util.UUID.randomUUID().toString());
    }

    private static final String CORRECTION = "{\"type\":\"EC_CEDULA\",\"currentNumber\":\"0912345675\",\"number\":\"1710034065\",\"currentPassword\":\"Lectura-segura-2026\"}";

    @Test
    void authenticatedOwnerRegistersAndReadsTheCedulaButCannotRemoveIt() throws Exception {
        String token = auth(10);
        mvc.perform(get("/api/v1/me/billing-identity").header("Authorization", token))
                .andExpect(status().isNoContent()).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"EC_CEDULA\",\"number\":\" 0912345675 \"}"))
                .andExpect(status().isNoContent());
        verify(billingGateway).register(10, "EC_CEDULA", "0912345675");
        when(billingGateway.find(10)).thenReturn(new com.pliego.modules.customer.application.BillingIdentity("EC_CEDULA", "0912345675"));
        mvc.perform(get("/api/v1/me/billing-identity").header("Authorization", token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.type").value("EC_CEDULA"))
                .andExpect(jsonPath("$.number").value("0912345675"))
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(delete("/api/v1/me/billing-identity").header("Authorization", token))
                .andExpect(status().isMethodNotAllowed()).andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"));
        verify(billingGateway, never()).correct(anyLong(), any(), any(), any());
    }

    @Test
    void registeringADifferentNumberIsAConflictInSpanishWithoutEchoingIt() throws Exception {
        doThrow(exceptionTranslator.translate(new java.sql.SQLException("0912345675 private", "P1105")))
                .when(billingGateway).register(10, "EC_CEDULA", "1710034065");
        mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", auth(10))
                .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"EC_CEDULA\",\"number\":\"1710034065\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P1105"))
                .andExpect(jsonPath("$.title").value("Tu identificación cambió"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("0912345675"))));
    }

    @Test
    void correctionRequiresTheCurrentPasswordAndTheNumberTheCustomerSaw() throws Exception {
        gateway.passwordHash = passwordEncoder.encode("Lectura-segura-2026");
        mvc.perform(post("/api/v1/me/billing-identity/correction").header("Authorization", auth(10))
                .contentType(MediaType.APPLICATION_JSON).content(CORRECTION.replace("Lectura-segura-2026", "otra-clave")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CURRENT_PASSWORD_INVALID"));
        verify(billingGateway, never()).correct(anyLong(), any(), any(), any());
        mvc.perform(post("/api/v1/me/billing-identity/correction").header("Authorization", auth(10))
                .contentType(MediaType.APPLICATION_JSON).content(CORRECTION))
                .andExpect(status().isNoContent()).andExpect(header().string("Cache-Control", "no-store"));
        verify(billingGateway).correct(10, "EC_CEDULA", "0912345675", "1710034065");
    }

    @Test
    void correctionRejectsMissingPasswordSameNumberOrInvalidNumberBeforeGateway() throws Exception {
        gateway.passwordHash = passwordEncoder.encode("Lectura-segura-2026");
        for (String body : new String[]{
                CORRECTION.replace(",\"currentPassword\":\"Lectura-segura-2026\"", ""),
                CORRECTION.replace("1710034065", "0912345675"),
                CORRECTION.replace("1710034065", "1710034066"),
                CORRECTION.replace("\"currentNumber\":\"0912345675\",", "")}) {
            mvc.perform(post("/api/v1/me/billing-identity/correction").header("Authorization", auth(10))
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("1710034066"))));
        }
        verifyNoInteractions(billingGateway);
    }

    @Test
    void staleCorrectionKeepsTheConflictCode() throws Exception {
        gateway.passwordHash = passwordEncoder.encode("Lectura-segura-2026");
        doThrow(exceptionTranslator.translate(new java.sql.SQLException("private", "P1105")))
                .when(billingGateway).correct(10, "EC_CEDULA", "0912345675", "1710034065");
        mvc.perform(post("/api/v1/me/billing-identity/correction").header("Authorization", auth(10))
                .contentType(MediaType.APPLICATION_JSON).content(CORRECTION))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P1105"))
                .andExpect(jsonPath("$.detail").value("La identificación de tu perfil no es la que estabas viendo. Revisa la actual antes de continuar."));
    }

    @Test
    void invalidOrUnsupportedIdentityNeverReachesGatewayAndDoesNotEchoNumber() throws Exception {
        for (String body : new String[]{"{}", "{\"type\":\"RUC\",\"number\":\"0912345675\"}",
                "{\"type\":\"EC_CEDULA\",\"number\":\"0000000000\"}",
                "{\"type\":\"EC_CEDULA\",\"number\":\"0012345675\"}",
                "{\"type\":\"EC_CEDULA\",\"number\":\"0012345674\"}",
                "{\"type\":\"EC_CEDULA\",\"number\":\"1791234561001\"}",
                "{\"type\":\"EC_RUC\",\"number\":\"0912345675\"}",
                "{\"type\":\"EC_RUC\",\"number\":\"1790016918001\"}",
                "{\"type\":\"EC_RUC\",\"number\":\"1710034065000\"}"}) {
            mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", auth(10))
                    .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("0012345675"))));
        }
        verifyNoInteractions(billingGateway);
    }

    @Test
    void registersAndCorrectsToAValidRucOfEachKind() throws Exception {
        for (String ruc : new String[]{"1710034065001", "1790016919001", "1760001200001"}) {
            mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", auth(10))
                    .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"EC_RUC\",\"number\":\" " + ruc + " \"}"))
                    .andExpect(status().isNoContent());
            verify(billingGateway).register(10, "EC_RUC", ruc);
        }
        gateway.passwordHash = passwordEncoder.encode("Lectura-segura-2026");
        mvc.perform(post("/api/v1/me/billing-identity/correction").header("Authorization", auth(10))
                .contentType(MediaType.APPLICATION_JSON)
                .content(CORRECTION.replace("\"type\":\"EC_CEDULA\"", "\"type\":\"EC_RUC\"").replace("1710034065", "1790016919001")))
                .andExpect(status().isNoContent());
        verify(billingGateway).correct(10, "EC_RUC", "0912345675", "1790016919001");
    }

    @Test
    void invalidNumberIsReportedOnTheNumberField() throws Exception {
        mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", auth(10))
                .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"EC_RUC\",\"number\":\"1790016918001\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("number"))
                .andExpect(jsonPath("$.violations[0].message").value("Ingresa una cédula (10 dígitos) o un RUC (13 dígitos) válidos"));
    }

    @Test
    void noAnonymousAccessAndActorAlwaysComesFromAuthenticatedSubject() throws Exception {
        mvc.perform(get("/api/v1/me/billing-identity")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/v1/me/billing-identity").contentType(MediaType.APPLICATION_JSON)
                .content("{}" )).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/me/billing-identity/correction").contentType(MediaType.APPLICATION_JSON)
                .content(CORRECTION)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/me/billing-identity?actorUserId=10").header("Authorization", auth(20)))
                .andExpect(status().isNoContent());
        verify(billingGateway).find(20);
        verify(billingGateway, never()).find(10);
    }

    @Test
    void editingGeneralProfileNeverTouchesIdentity() throws Exception {
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
        mvc.perform(post("/api/v1/me/billing-identity/correction").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content(CORRECTION)).andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"type\":\"EC_CEDULA\",\"number\":\"0912345675\"}"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(billingGateway);
    }

    @Test
    void rejectsInjectedOwnerAndDoesNotExposeDatabaseErrors() throws Exception {
        mvc.perform(put("/api/v1/me/billing-identity").header("Authorization", auth(10))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"EC_CEDULA\",\"number\":\"0912345675\",\"actorUserId\":20}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(billingGateway);
        when(billingGateway.find(10)).thenThrow(exceptionTranslator.translate(new java.sql.SQLException("0912345675 private SQL", "P1005")));
        mvc.perform(get("/api/v1/me/billing-identity").header("Authorization", auth(10)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("P1005"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("0912345675"))));
    }
}
