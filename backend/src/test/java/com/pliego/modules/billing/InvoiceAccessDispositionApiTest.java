package com.pliego.modules.billing;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;

import com.pliego.foundation.security.AuthSessionRequestFilter;
import com.pliego.foundation.security.SecurityConfiguration;
import com.pliego.foundation.security.SecurityProblemWriter;
import com.pliego.foundation.web.ApiExceptionHandler;
import com.pliego.foundation.web.ProblemDetailFactory;
import com.pliego.foundation.web.TraceIdFilter;
import com.pliego.modules.billing.api.BillingController;
import com.pliego.modules.billing.application.BillingService;
import com.pliego.modules.billing.application.InvoiceDocumentStore;
import com.pliego.modules.billing.application.R2InvoiceDocumentStore;
import com.pliego.modules.billing.application.R2ObjectClient;
import com.pliego.modules.billing.application.R2PresignedUrlSigner;
import com.pliego.modules.billing.application.R2StorageProperties;
import com.pliego.modules.billing.gateway.BillingGateway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(BillingController.class)
@Import({BillingService.class, SecurityConfiguration.class, SecurityProblemWriter.class,
        AuthSessionRequestFilter.class, TraceIdFilter.class, ApiExceptionHandler.class, ProblemDetailFactory.class,
        InvoiceAccessDispositionApiTest.R2StoreTestConfiguration.class,
        InvoiceAccessDispositionApiTest.SecurityTestConfiguration.class})
class InvoiceAccessDispositionApiTest {
    @TestConfiguration(proxyBeanMethods = false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    static class SecurityTestConfiguration { }

    @TestConfiguration(proxyBeanMethods = false)
    static class R2StoreTestConfiguration {
        @Bean
        InvoiceDocumentStore invoiceDocumentStore(BillingGateway gateway, R2PresignedUrlSigner signer) {
            var properties = new R2StorageProperties(false, null, null, "auto", null, null, "300", "invoices/");
            return new R2InvoiceDocumentStore(gateway, mock(R2ObjectClient.class), signer, properties);
        }
    }

    @Autowired MockMvc mvc;
    @MockitoBean BillingGateway gateway;
    @MockitoBean R2PresignedUrlSigner signer;
    @MockitoBean JwtDecoder decoder;

    @BeforeEach
    void authenticateFixtures() {
        for (String token : List.of("owner", "other")) {
            when(decoder.decode(token)).thenReturn(Jwt.withTokenValue(token).header("alg", "HS256")
                    .subject("other".equals(token) ? "8" : "7").claim("role", "CUSTOMER")
                    .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build());
        }
    }

    @Test
    void invalidDispositionReturnsSpanish400BeforeDatabaseOrSigning() throws Exception {
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access?disposition=preview")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer owner"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.detail").value("La presentación debe ser inline o attachment."));
        verifyNoInteractions(gateway, signer);
    }

    @Test
    void anonymousRequestReturns401WithoutDatabaseOrSigning() throws Exception {
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access?disposition=attachment"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(gateway, signer);
    }

    @Test
    void anotherCustomerGets404BeforeR2SignerIsInvoked() throws Exception {
        when(gateway.access(8, 9, "PDF")).thenReturn(null);
        mvc.perform(get("/api/v1/orders/9/invoice/files/PDF/access?disposition=attachment")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer other"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INVOICE_NOT_FOUND"));
        verify(gateway).access(8, 9, "PDF");
        verifyNoInteractions(signer);
    }
}
