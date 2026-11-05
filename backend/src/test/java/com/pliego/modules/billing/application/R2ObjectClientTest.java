package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class R2ObjectClientTest {
    @Mock private HttpClient transport;
    private final R2StorageProperties properties = new R2StorageProperties(true, "billing-pliego",
            "https://r2.example.invalid", "auto", "fictional-access", "fictional-secret", "300", "local-dev/invoices/", false);
    private final R2PresignedUrlSigner signer = new R2PresignedUrlSigner();
    private static final String KEY = "local-dev/invoices/123/" + "a".repeat(64) + ".pdf";

    @ParameterizedTest
    @ValueSource(strings = {"invoices/123/a.pdf", "local-dev/invoices-other/123/a.pdf", "other/a.pdf"})
    void operations_outsidePrefix_rejectBeforeTransportOrPresigning(String key) {
        var objects = new R2ObjectClient(properties, new R2RequestSigner(), transport);
        assertThatThrownBy(() -> objects.getObject(key)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("prefijo");
        assertThatThrownBy(() -> objects.putObject(key, new byte[]{1}, "application/pdf"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("prefijo");
        assertThatThrownBy(() -> objects.deleteObject(key)).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("prefijo");
        assertThatThrownBy(() -> signer.presignR2Get(properties, key, "application/pdf", "inline", Instant.now()))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("prefijo");
        assertThatThrownBy(() -> signer.presignR2Get(properties, key, "application/pdf", "inline", 900, Instant.now()))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("prefijo");
        assertThatThrownBy(() -> objects.getPresignedObject(URI.create("https://r2.example.invalid/billing-pliego/" + key + "?X-Amz-Signature=fake")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("prefijo");
        verifyNoInteractions(transport);
    }

    @ParameterizedTest
    @ValueSource(strings = {"local-dev/invoices/../invoices/a.pdf", "local-dev/invoices/a?b", "/local-dev/invoices/a.pdf"})
    void presignR2Get_malformedKey_rejectsBeforeSigning(String key) {
        assertThatThrownBy(() -> signer.presignR2Get(properties, key, "application/pdf", "inline", Instant.now()))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(transport);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://other.example.invalid/billing-pliego/local-dev/invoices/a.pdf",
            "https://r2.example.invalid/other-bucket/local-dev/invoices/a.pdf",
            "https://r2.example.invalid/billing-pliego/local-dev/invoices/%2e%2e/invoices/a.pdf"})
    void getPresignedObject_wrongEndpointBucketOrTraversal_neverUsesTransport(String url) {
        var objects = new R2ObjectClient(properties, new R2RequestSigner(), transport);
        assertThatThrownBy(() -> objects.getPresignedObject(URI.create(url))).isInstanceOf(RuntimeException.class);
        verifyNoInteractions(transport);
    }

    @Test
    @SuppressWarnings("unchecked")
    void operations_withinPrefix_keepSignedRequestsAndContent() throws Exception {
        var objects = new R2ObjectClient(properties, new R2RequestSigner(), transport);
        byte[] content = {1, 2, 3};
        HttpResponse<Object> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenAnswer(invocation -> new ByteArrayInputStream(content));
        doReturn(response).when(transport).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));

        objects.putObject(KEY, content, "application/pdf");
        assertThat(objects.getObject(KEY)).containsExactly(content);
        var signed = signer.presignR2Get(properties, KEY, "application/pdf", "inline", Instant.now());
        assertThat(signed.url()).startsWith("https://r2.example.invalid/billing-pliego/" + KEY + "?").contains("X-Amz-Expires=300");
        assertThat(objects.getPresignedObject(URI.create(signed.url()))).containsExactly(content);
        objects.deleteObject(KEY);

        var requests = ArgumentCaptor.forClass(HttpRequest.class);
        verify(transport, times(4)).send(requests.capture(), any(HttpResponse.BodyHandler.class));
        assertThat(requests.getAllValues()).extracting(HttpRequest::method).containsExactly("PUT", "GET", "GET", "DELETE");
        assertThat(requests.getAllValues()).allSatisfy(request ->
                assertThat(request.uri().getPath()).isEqualTo("/billing-pliego/" + KEY));
        assertThat(requests.getAllValues().getFirst().headers().firstValue("Authorization")).isPresent();
        assertThat(requests.getAllValues().get(2).headers().firstValue("Authorization")).isEmpty();
    }
}
