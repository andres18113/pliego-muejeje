package com.pliego.modules.customer.api;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import com.pliego.modules.customer.application.AdminBillingIdentityCorrection;
import com.pliego.modules.customer.application.BillingIdentityCorrection;
import com.pliego.modules.customer.application.BillingIdentityCorrectionDecision;
import com.pliego.modules.customer.application.BillingIdentityCorrectionPage;
import com.pliego.modules.customer.gateway.BillingIdentityCorrectionGateway;
import com.pliego.modules.customer.gateway.BillingIdentityGateway;

class BillingIdentityCorrectionApiIntegrationTest extends CustomerApiIntegrationTest {
    private static final String SUBMIT = """
            {"type":"EC_CEDULA","currentNumber":"0912345675","number":"1710034065",
             "reasonCode":"DOCUMENT_TYPO","note":"  El número se registró mal.  "}
            """;

    @MockitoBean BillingIdentityGateway billingIdentityGateway;
    @MockitoBean BillingIdentityCorrectionGateway correctionGateway;

    private String customerToken(long actor) {
        var now = java.time.Instant.now();
        return "Bearer " + tokenIssuer.issue(Long.toString(actor), "CUSTOMER", now, now.plusSeconds(1800), UUID.randomUUID().toString());
    }

    private String adminToken(long actor) {
        var now = java.time.Instant.now();
        return "Bearer " + tokenIssuer.issue(Long.toString(actor), "ADMIN", now, now.plusSeconds(1800), UUID.randomUUID().toString());
    }

    @Test
    void submitCorrectionReturnsTheDatabaseRequestAndUsesTheIdempotencyKey() throws Exception {
        UUID key = UUID.fromString("40c82504-bb4e-4f6d-8a2f-641039c9084a");
        var created = new BillingIdentityCorrection("55", "PENDING", "EC_CEDULA", "1710034065", "DOCUMENT_TYPO",
                OffsetDateTime.parse("2026-10-25T12:00:00Z"), OffsetDateTime.parse("2026-11-09T12:00:00Z"), null, null);
        when(correctionGateway.submit(10, key, "0912345675", "EC_CEDULA", "1710034065",
                "DOCUMENT_TYPO", "El número se registró mal.")).thenReturn(created);

        mvc.perform(post("/api/v1/me/billing-identity/correction-requests")
                        .header("Authorization", customerToken(10)).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(SUBMIT))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/me/billing-identity/correction-requests/55"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.id").value("55"))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.proposedType").value("EC_CEDULA"))
                .andExpect(jsonPath("$.proposedNumber").value("1710034065"))
                .andExpect(jsonPath("$.reasonCode").value("DOCUMENT_TYPO"))
                .andExpect(jsonPath("$.createdAt").value("2026-10-25T12:00:00Z"))
                .andExpect(jsonPath("$.dueAt").value("2026-11-09T12:00:00Z"))
                .andExpect(jsonPath("$.decidedAt").doesNotExist())
                .andExpect(jsonPath("$.decisionReason").doesNotExist());
        verify(correctionGateway).submit(10, key, "0912345675", "EC_CEDULA", "1710034065",
                "DOCUMENT_TYPO", "El número se registró mal.");
    }

    @Test
    void withdrawOnlyCallsTheOwnerScopedDatabaseCommand() throws Exception {
        mvc.perform(post("/api/v1/me/billing-identity/correction-requests/55/withdraw")
                        .header("Authorization", customerToken(10)))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Cache-Control", "no-store"));
        verify(correctionGateway).withdraw(10, 55);
    }

    @Test
    void aForeignRequestIdUsesTheEstablishedNotFoundProblem() throws Exception {
        doThrow(exceptionTranslator.translate(new SQLException("private request detail", "P1109")))
                .when(correctionGateway).withdraw(10, 999);

        mvc.perform(post("/api/v1/me/billing-identity/correction-requests/999/withdraw")
                        .header("Authorization", customerToken(10)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("P1109"))
                .andExpect(jsonPath("$.title").value("Solicitud no encontrada"))
                .andExpect(jsonPath("$.detail").value("La solicitud no existe o no está disponible para esta cuenta."));
    }

    @Test
    void nonPositiveRequestIdsFailValidationBeforeTheDatabase() throws Exception {
        mvc.perform(post("/api/v1/me/billing-identity/correction-requests/-1/withdraw")
                        .header("Authorization", customerToken(10)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        verifyNoInteractions(correctionGateway);
    }

    @Test
    void pendingNotRequiredAndClosedRequestErrorsKeepTheirSpanishSqlstateProblems() throws Exception {
        UUID key = UUID.fromString("40c82504-bb4e-4f6d-8a2f-641039c9084a");
        doThrow(exceptionTranslator.translate(new SQLException("private", "P1108")))
                .when(correctionGateway).submit(10, key, "0912345675", "EC_CEDULA", "1710034065",
                        "DOCUMENT_TYPO", "El número se registró mal.");
        mvc.perform(post("/api/v1/me/billing-identity/correction-requests")
                        .header("Authorization", customerToken(10)).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(SUBMIT))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P1108"))
                .andExpect(jsonPath("$.title").value("Ya tienes una solicitud pendiente"))
                .andExpect(jsonPath("$.detail").value("Ya existe una solicitud de corrección pendiente para esta cuenta."));

        UUID secondKey = UUID.fromString("2abca77d-2a78-43e1-84e1-7a250a09c426");
        doThrow(exceptionTranslator.translate(new SQLException("private", "P1110")))
                .when(correctionGateway).submit(10, secondKey, "0912345675", "EC_CEDULA", "1710034065",
                        "DOCUMENT_TYPO", "El número se registró mal.");
        mvc.perform(post("/api/v1/me/billing-identity/correction-requests")
                        .header("Authorization", customerToken(10)).header("Idempotency-Key", secondKey)
                        .contentType(MediaType.APPLICATION_JSON).content(SUBMIT))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P1110"))
                .andExpect(jsonPath("$.title").value("Puedes corregirla directamente"));

        doThrow(exceptionTranslator.translate(new SQLException("private", "P1111")))
                .when(correctionGateway).decide(30, 55, "APPROVE", null);
        mvc.perform(post("/api/v1/admin/billing-identity-corrections/55/decision")
                        .header("Authorization", adminToken(30)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"APPROVE\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("P1111"))
                .andExpect(jsonPath("$.title").value("Solicitud ya atendida"))
                .andExpect(jsonPath("$.detail").value("La solicitud ya no está pendiente y no puede cambiarse."));
    }

    @Test
    void customerCannotReachTheAdminCorrectionQueueOrDecision() throws Exception {
        mvc.perform(get("/api/v1/admin/billing-identity-corrections").header("Authorization", customerToken(10)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        mvc.perform(post("/api/v1/admin/billing-identity-corrections/55/decision")
                        .header("Authorization", customerToken(10)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"APPROVE\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        verifyNoInteractions(correctionGateway);
    }

    @Test
    void adminCanListOldestDueRequestsAndDecideWithSpanishRejectionReason() throws Exception {
        var row = new AdminBillingIdentityCorrection("55", "42", "Ana Pérez", "ana@example.invalid",
                "EC_CEDULA", "0912345675", "EC_CEDULA", "1710034065", "DOCUMENT_TYPO",
                "El número se registró mal.", "PENDING", OffsetDateTime.parse("2026-10-25T12:00:00Z"),
                OffsetDateTime.parse("2026-11-09T12:00:00Z"), null, null, null);
        when(correctionGateway.search(30, "PENDING", 0, 20)).thenReturn(new BillingIdentityCorrectionPage(List.of(row), 1));
        when(correctionGateway.decide(30, 55, "REJECT", "La documentación no permite confirmar el cambio solicitado."))
                .thenReturn(new BillingIdentityCorrectionDecision("55", "REJECTED",
                        OffsetDateTime.parse("2026-10-25T12:30:00Z"), "30",
                        "La documentación no permite confirmar el cambio solicitado."));

        mvc.perform(get("/api/v1/admin/billing-identity-corrections").header("Authorization", adminToken(30))
                        .param("status", "PENDING"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value("55"))
                .andExpect(jsonPath("$.items[0].currentNumber").value("0912345675"))
                .andExpect(jsonPath("$.items[0].proposedNumber").value("1710034065"))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.pageSize").value(20))
                .andExpect(jsonPath("$.totalCount").value("1"));
        verify(correctionGateway).search(30, "PENDING", 0, 20);

        mvc.perform(post("/api/v1/admin/billing-identity-corrections/55/decision")
                        .header("Authorization", adminToken(30)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"REJECT\",\"decisionReason\":\"La documentación no permite confirmar el cambio solicitado.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("55"))
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.decidedBy").value("30"))
                .andExpect(jsonPath("$.decisionReason").value("La documentación no permite confirmar el cambio solicitado."));
        verify(correctionGateway).decide(30, 55, "REJECT", "La documentación no permite confirmar el cambio solicitado.");
    }
}
