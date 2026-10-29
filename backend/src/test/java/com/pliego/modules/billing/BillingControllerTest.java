package com.pliego.modules.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ProblemDetail;
import org.springframework.security.oauth2.jwt.Jwt;
import com.pliego.modules.billing.api.BillingController;
import com.pliego.modules.billing.application.BillingService;
import com.pliego.modules.billing.application.InvoiceDownload;

class BillingControllerTest {
    private final BillingService service = mock(BillingService.class);
    private final BillingController controller = new BillingController(service);
    private final Jwt jwt = new Jwt("not-a-real-token", Instant.now(), Instant.now().plusSeconds(60),
            Map.of("alg", "HS256"), Map.of("sub", "7"));

    @Test void absentLegacyFileIsUnavailableInsteadOfPerpetuallyPreparing() {
        when(service.metadata(7, 9)).thenReturn(new tools.jackson.databind.ObjectMapper()
                .readTree("{\"provenance\":\"LEGACY\",\"files\":[{\"type\":\"PDF\",\"state\":\"UNAVAILABLE\"}]}"));
        var response = controller.download(jwt, 9, "PDF", "attachment");
        assertThat(response.getStatusCode().value()).isEqualTo(404);
        assertThat(((ProblemDetail) response.getBody()).getProperties().get("code")).isEqualTo("INVOICE_FILE_UNAVAILABLE");
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(((ProblemDetail) response.getBody()).getDetail()).doesNotContain("preparando");
    }

    @Test void simulatedFileWithoutBytesRemainsInPreparation() {
        when(service.metadata(7, 9)).thenReturn(new tools.jackson.databind.ObjectMapper()
                .readTree("{\"provenance\":\"SIMULATED\"}"));
        assertThat(controller.download(jwt, 9, "XML", "attachment").getStatusCode().value()).isEqualTo(409);
    }

    @Test void administratorAliasMapsMetadataAndDownloadWithoutChangingTheActor() throws Exception {
        var context = org.springframework.security.core.context.SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                jwt, null, java.util.List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_ADMIN"))));
        org.springframework.security.core.context.SecurityContextHolder.setContext(context);
        try {
            var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller)
                    .setCustomArgumentResolvers(new org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver())
                    .build();
            when(service.download(7, 9, "PDF")).thenReturn(new InvoiceDownload(new byte[]{1}, "application/pdf", "factura.pdf", "hash"));
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/admin/orders/9/invoice"))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotFound());
            verify(service).metadata(7, 9);
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/admin/orders/9/invoice/files/PDF"))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
            verify(service).download(7, 9, "PDF");
        } finally {
            org.springframework.security.core.context.SecurityContextHolder.clearContext();
        }
    }

    @Test void documentNotReadyExplainsThatThePurchaseAlreadyExists() {
        var response = controller.download(jwt, 9, "PDF", "attachment");
        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(((ProblemDetail) response.getBody()).getDetail()).contains("compra está registrada");
        assertThat(((ProblemDetail) response.getBody()).getProperties().get("code")).isEqualTo("INVOICE_FILE_NOT_READY");
        verify(service).download(7, 9, "PDF");
    }

    @Test void downloadIsPrivateAndUsesOnlyTheAuthenticatedActor() {
        when(service.download(7, 9, "PDF")).thenReturn(new InvoiceDownload(new byte[]{1, 2}, "application/pdf", "factura.pdf", "hash"));
        var response = controller.download(jwt, 9, "PDF", "attachment");
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION)).contains("attachment").contains("factura.pdf");
        assertThat(response.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
    }

    @Test void metadataAbsenceDoesNotFabricateADocument() {
        assertThat(controller.metadata(jwt, 9).getStatusCode().value()).isEqualTo(404);
        verify(service).metadata(7, 9);
    }

    @Test void downloadBytesAreNotMutableThroughTheRecord() {
        byte[] bytes = {1, 2};
        var file = new InvoiceDownload(bytes, "application/pdf", "factura.pdf", "hash");
        bytes[0] = 9;
        file.content()[0] = 8;
        assertThat(file.content()).containsExactly((byte) 1, (byte) 2);
        assertThat(file.toString()).doesNotContain("hash");
    }
}
