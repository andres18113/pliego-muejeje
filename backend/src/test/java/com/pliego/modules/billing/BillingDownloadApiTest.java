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
        when(gateway.download(7, 9, "PDF")).thenReturn(file("PDF"));
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
        verify(gateway).download(7, 9, "PDF");
        verifyNoMoreInteractions(gateway);
    }

    @Test
    void download_defaultAndExplicitAttachment_shouldKeepPdfAndXmlDownloads() throws Exception {
        for (String type : List.of("PDF", "XML")) {
            when(gateway.download(7, 9, type)).thenReturn(file(type));
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
        when(gateway.download(8, 9, "PDF")).thenThrow(new DatabaseExceptionTranslator()
                .translate(new SQLException("private database detail", "P5001")));
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline&actorId=7")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer other"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("P5001"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("private database detail"))))
                .andExpect(header().doesNotExist(HttpHeaders.CONTENT_DISPOSITION));
        verify(gateway).download(8, 9, "PDF");
        verifyNoMoreInteractions(gateway);
    }

    @Test
    void download_missingAuthenticationOrWrongRole_shouldNeverReadArtifacts() throws Exception {
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer admin"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admin/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(gateway);
    }

    @Test
    void download_administratorAlias_shouldAllowInlineForAdministrator() throws Exception {
        when(gateway.download(7, 9, "PDF")).thenReturn(file("PDF"));
        mvc.perform(get("/api/v1/admin/orders/9/invoice/files/PDF?disposition=inline")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer admin"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, org.hamcrest.Matchers.startsWith("inline;")));
    }

    private static InvoiceDownload file(String type) {
        String extension = type.toLowerCase(java.util.Locale.ROOT);
        return new InvoiceDownload(new byte[]{1, 2}, "application/" + extension, "factura." + extension, "hash");
    }
}
