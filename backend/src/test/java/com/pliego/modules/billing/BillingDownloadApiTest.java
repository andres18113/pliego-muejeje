package com.pliego.modules.billing;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.sql.SQLException;
import java.time.Instant;
import java.util.List;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.security.AuthSessionRequestFilter;
import com.pliego.foundation.security.SecurityConfiguration;
import com.pliego.foundation.security.SecurityProblemWriter;
import com.pliego.foundation.web.ApiExceptionHandler;
import com.pliego.foundation.web.ProblemDetailFactory;
import com.pliego.foundation.web.TraceIdFilter;
import com.pliego.modules.billing.api.BillingController;
import com.pliego.modules.billing.application.BillingService;
import com.pliego.modules.billing.application.InvoiceDownload;
import com.pliego.modules.billing.application.InvoiceDocumentAccess;
import com.pliego.modules.billing.application.InvoiceDocumentAccessResult;
import com.pliego.modules.billing.application.InvoiceDocumentStore;
import com.pliego.modules.billing.application.InvoiceDocumentUnavailableException;
import com.pliego.modules.billing.gateway.BillingGateway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(BillingController.class)
@Import({BillingService.class, SecurityConfiguration.class, SecurityProblemWriter.class,
        AuthSessionRequestFilter.class, TraceIdFilter.class, ApiExceptionHandler.class, ProblemDetailFactory.class,
        BillingDownloadApiTest.SecurityTestConfiguration.class})
class BillingDownloadApiTest {
    @TestConfiguration(proxyBeanMethods = false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    static class SecurityTestConfiguration { }

    @Autowired MockMvc mvc;
    @MockitoBean BillingGateway gateway;
    @MockitoBean InvoiceDocumentStore documents;
    @MockitoBean JwtDecoder decoder;

    @BeforeEach
    void authenticateFixtures() {
        for (String token : List.of("owner", "other", "admin")) {
            when(decoder.decode(token)).thenReturn(Jwt.withTokenValue(token).header("alg", "HS256")
                    .subject("other".equals(token) ? "8" : "7")
                    .claim("role", "admin".equals(token) ? "ADMIN" : "CUSTOMER")
                    .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build());
        }
    }

    @Test
    void download_pdfInline_shouldReturnPrivateBytesAndInlineDisposition() throws Exception {
        when(documents.download(7, 9, "PDF")).thenReturn(file("PDF"));
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline&actorId=8")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isOk())
                .andExpect(content().bytes(new byte[]{1, 2}))
                .andExpect(content().contentType("application/pdf"))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, org.hamcrest.Matchers.startsWith("inline;")))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, org.hamcrest.Matchers.containsString("factura.pdf")))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().longValue(HttpHeaders.CONTENT_LENGTH, 2));
        verify(documents).download(7, 9, "PDF");
    }

    @Test
    void download_defaultAndExplicitAttachment_shouldKeepPdfAndXmlDownloads() throws Exception {
        for (String type : List.of("PDF", "XML")) {
            when(documents.download(7, 9, type)).thenReturn(file(type));
            for (String query : List.of("", "?disposition=attachment")) {
                mvc.perform(get("/api/v1/orders/9/invoice/files/" + type + query)
                                .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                        .andExpect(status().isOk())
                        .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, org.hamcrest.Matchers.startsWith("attachment;")))
                        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                        .andExpect(header().string("X-Content-Type-Options", "nosniff"));
            }
        }
    }

    @Test
    void download_xmlInlineOrUnknownDisposition_shouldRejectWithSpanishValidation() throws Exception {
        for (String path : List.of("XML?disposition=inline", "PDF?disposition=preview")) {
            mvc.perform(get("/api/v1/orders/9/invoice/files/" + path)
                            .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.title").value("Datos inválidos"));
        }
        verifyNoInteractions(gateway);
    }

    @Test
    void download_inlineWithoutBytes_shouldPreservePreparingAndLegacyResponses() throws Exception {
        when(gateway.metadata(7, 9)).thenReturn("{\"provenance\":\"SIMULATED\"}");
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVOICE_FILE_NOT_READY"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
        when(gateway.metadata(7, 9)).thenReturn("{\"provenance\":\"LEGACY\"}");
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INVOICE_FILE_UNAVAILABLE"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
    }

    @Test
    void download_anotherCustomer_shouldPreserveOrderNotFoundWithoutBytes() throws Exception {
        when(documents.download(8, 9, "PDF")).thenThrow(new DatabaseExceptionTranslator()
                .translate(new SQLException("private database detail", "P5001")));
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline&actorId=7")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer other"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("P5001"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("private database detail"))))
                .andExpect(header().doesNotExist(HttpHeaders.CONTENT_DISPOSITION));
        verify(documents).download(8, 9, "PDF");
    }

    @Test
    void download_missingAuthenticationOrWrongRole_shouldNeverReadArtifacts() throws Exception {
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer admin"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admin/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(gateway);
        verifyNoInteractions(documents);
    }

    @Test
    void download_administratorAlias_shouldAllowInlineForAdministrator() throws Exception {
        when(documents.download(7, 9, "PDF")).thenReturn(file("PDF"));
        mvc.perform(get("/api/v1/admin/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer admin"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, org.hamcrest.Matchers.startsWith("inline;")));
    }

    @Test
    void unavailableR2Object_keepsTheSpanishInvoiceFileProblemCode() throws Exception {
        when(documents.download(7, 9, "PDF")).thenThrow(new InvoiceDocumentUnavailableException());
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INVOICE_FILE_UNAVAILABLE"))
                .andExpect(jsonPath("$.title").value("Documento no disponible"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
    }

    private static InvoiceDownload file(String type) {
        String extension = type.toLowerCase(java.util.Locale.ROOT);
        return new InvoiceDownload(new byte[]{1, 2}, "application/" + extension, "factura." + extension, "hash");
    }

    @Test
    void access_returnsAuthenticatedDatabaseStreamUrlAndNoStore() throws Exception {
        when(documents.access(7, 9, "PDF", "/api/v1/orders/9/invoice/files/PDF?disposition=inline", "inline"))
                .thenReturn(new InvoiceDocumentAccessResult("SIMULATED", "READY",
                        new InvoiceDocumentAccess("API_STREAM", "/api/v1/orders/9/invoice/files/PDF?disposition=inline", null)));
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.delivery").value("API_STREAM"))
                .andExpect(jsonPath("$.url").value("/api/v1/orders/9/invoice/files/PDF?disposition=inline"))
                .andExpect(jsonPath("$.expiresAt").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
        verify(documents).access(7, 9, "PDF", "/api/v1/orders/9/invoice/files/PDF?disposition=inline", "inline");
    }

    @Test
    void access_attachmentReturnsDownloadUrlForDatabaseArtifact() throws Exception {
        String url = "/api/v1/orders/9/invoice/files/PDF?disposition=attachment";
        when(documents.access(7, 9, "PDF", url, "attachment")).thenReturn(new InvoiceDocumentAccessResult("SIMULATED", "READY",
                new InvoiceDocumentAccess("API_STREAM", url, null)));
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access?disposition=attachment")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.delivery").value("API_STREAM"))
                .andExpect(jsonPath("$.url").value(url));
        verify(documents).access(7, 9, "PDF", url, "attachment");
    }

    @Test
    void access_unknownDispositionReturnsSpanishValidationProblemBeforeReading() throws Exception {
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access?disposition=preview")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.title").value("Datos inválidos"))
                .andExpect(jsonPath("$.detail").value("La presentación debe ser inline o attachment."));
        verifyNoInteractions(gateway, documents);
    }

    @Test
    void access_anotherCustomerGetsNotFound() throws Exception {
        when(documents.access(8, 9, "PDF", "/api/v1/orders/9/invoice/files/PDF?disposition=inline", "inline"))
                .thenReturn(null);
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer other"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INVOICE_NOT_FOUND"));
        verify(documents).access(8, 9, "PDF", "/api/v1/orders/9/invoice/files/PDF?disposition=inline", "inline");
    }

    @Test
    void access_adminAliasUsesItsAuthenticatedStreamRoute() throws Exception {
        String url = "/api/v1/admin/orders/9/invoice/files/PDF?disposition=inline";
        when(documents.access(7, 9, "PDF", url, "inline")).thenReturn(new InvoiceDocumentAccessResult("SIMULATED", "READY",
                new InvoiceDocumentAccess("API_STREAM", url, null)));
        mvc.perform(get("/api/v1/admin/orders/9/invoice/files/PDF/access")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value(url));
        verify(documents).access(7, 9, "PDF", url, "inline");

        String attachmentUrl = "/api/v1/admin/orders/9/invoice/files/PDF?disposition=attachment";
        when(documents.access(7, 9, "PDF", attachmentUrl, "attachment"))
                .thenReturn(new InvoiceDocumentAccessResult("SIMULATED", "READY",
                        new InvoiceDocumentAccess("API_STREAM", attachmentUrl, null)));
        mvc.perform(get("/api/v1/admin/orders/9/invoice/files/PDF/access?disposition=attachment")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer admin"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value(attachmentUrl));
        verify(documents).access(7, 9, "PDF", attachmentUrl, "attachment");
    }

    @Test
    void access_r2ArtifactReturnsShortLivedSignedUrlOnlyAfterReadyAuthorization() throws Exception {
        var expires = java.time.Instant.parse("2026-10-27T12:05:00Z");
        when(documents.access(7, 9, "PDF", "/api/v1/orders/9/invoice/files/PDF?disposition=inline", "inline"))
                .thenReturn(new InvoiceDocumentAccessResult("SIMULATED", "READY",
                        new InvoiceDocumentAccess("SIGNED_URL", "https://r2.example.invalid/object?signature=fake", expires)));
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.delivery").value("SIGNED_URL"))
                .andExpect(jsonPath("$.url").value("https://r2.example.invalid/object?signature=fake"))
                .andExpect(jsonPath("$.expiresAt").value("2026-10-27T12:05:00Z"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
    }

    @Test
    void access_preservesMissingLegacyAndPreparingProblemResponses() throws Exception {
        for (var fixture : List.of(
                new Object[]{null, 404, "INVOICE_NOT_FOUND"},
                new Object[]{new InvoiceDocumentAccessResult("LEGACY", "UNAVAILABLE", null), 404, "INVOICE_FILE_UNAVAILABLE"},
                new Object[]{new InvoiceDocumentAccessResult("SIMULATED", "PROCESSING", null), 409, "INVOICE_FILE_NOT_READY"})) {
            reset(documents);
            when(documents.access(7, 9, "PDF", "/api/v1/orders/9/invoice/files/PDF?disposition=inline", "inline"))
                    .thenReturn((InvoiceDocumentAccessResult) fixture[0]);
            mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access")
                            .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                    .andExpect(status().is((Integer) fixture[1]))
                    .andExpect(jsonPath("$.code").value(fixture[2]))
                    .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
        }
    }
}
