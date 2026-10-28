package com.pliego.modules.billing.application;

import java.net.URI;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/** Private path-style R2 object operations over JDK HttpClient. No credentials or response bodies are logged. */
public final class R2ObjectClient {
    static final int MAX_OBJECT_BYTES = 10 * 1024 * 1024;
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);

    private final R2StorageProperties properties;
    private final R2RequestSigner requestSigner;
    private final HttpClient client;

    public R2ObjectClient(R2StorageProperties properties, R2RequestSigner requestSigner) {
        this(properties, requestSigner, HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NEVER).build());
    }

    R2ObjectClient(R2StorageProperties properties, R2RequestSigner requestSigner, HttpClient client) {
        this.properties = properties;
        this.requestSigner = requestSigner;
        this.client = client;
    }

    public void putObject(String objectKey, byte[] content, String mimeType) {
        if (content == null || content.length == 0 || content.length > MAX_OBJECT_BYTES)
            throw new InvoiceDocumentUploadException();
        try {
            URI uri = objectUri(objectKey);
            var signed = requestSigner.sign("PUT", uri, properties.accessKeyId(), properties.secretAccessKey(),
                    properties.region(), Instant.now(), content, Map.of("content-type", mimeType));
            var request = HttpRequest.newBuilder(uri).timeout(REQUEST_TIMEOUT)
                    .PUT(HttpRequest.BodyPublishers.ofByteArray(content));
            addHeaders(request, signed.headers());
            HttpResponse<Void> response = client.send(request.build(), HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new InvoiceDocumentUploadException();
        } catch (InvoiceDocumentUploadException known) {
            throw known;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new InvoiceDocumentUploadException();
        } catch (Exception failure) {
            throw new InvoiceDocumentUploadException();
        }
    }

    public byte[] getObject(String objectKey) {
        try {
            URI uri = objectUri(objectKey);
            var signed = requestSigner.sign("GET", uri, properties.accessKeyId(), properties.secretAccessKey(),
                    properties.region(), Instant.now(), new byte[0], Map.of());
            var request = HttpRequest.newBuilder(uri).timeout(REQUEST_TIMEOUT).GET();
            addHeaders(request, signed.headers());
            HttpResponse<InputStream> response = client.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
            return readObject(response);
        } catch (InvoiceDocumentUnavailableException known) {
            throw known;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new InvoiceDocumentUnavailableException();
        } catch (Exception failure) {
            throw new InvoiceDocumentUnavailableException();
        }
    }

    public byte[] getPresignedObject(URI presignedUrl) {
        try {
            if (presignedUrl == null || !"https".equalsIgnoreCase(presignedUrl.getScheme())
                    || presignedUrl.getRawUserInfo() != null || presignedUrl.getRawFragment() != null)
                throw new InvoiceDocumentUnavailableException();
            HttpRequest request = HttpRequest.newBuilder(presignedUrl).timeout(REQUEST_TIMEOUT).GET().build();
            HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            return readObject(response);
        } catch (InvoiceDocumentUnavailableException known) {
            throw known;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new InvoiceDocumentUnavailableException();
        } catch (Exception failure) {
            throw new InvoiceDocumentUnavailableException();
        }
    }

    public void deleteObject(String objectKey) {
        try {
            URI uri = objectUri(objectKey);
            var signed = requestSigner.sign("DELETE", uri, properties.accessKeyId(), properties.secretAccessKey(),
                    properties.region(), Instant.now(), new byte[0], Map.of());
            var request = HttpRequest.newBuilder(uri).timeout(REQUEST_TIMEOUT).DELETE();
            addHeaders(request, signed.headers());
            HttpResponse<Void> response = client.send(request.build(), HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new InvoiceDocumentUnavailableException();
        } catch (InvoiceDocumentUnavailableException known) {
            throw known;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new InvoiceDocumentUnavailableException();
        } catch (Exception failure) {
            throw new InvoiceDocumentUnavailableException();
        }
    }

    private URI objectUri(String objectKey) throws java.net.URISyntaxException {
        if (objectKey == null || objectKey.isBlank() || objectKey.startsWith("/") || objectKey.contains("..")
                || objectKey.contains("\\") || objectKey.contains("?"))
            throw new IllegalArgumentException("Clave de objeto R2 inválida.");
        URI endpoint = properties.endpointUri();
        return new URI(endpoint.getScheme(), null, endpoint.getHost(), endpoint.getPort(),
                "/" + properties.bucket() + "/" + objectKey, null, null);
    }

    private static byte[] readObject(HttpResponse<InputStream> response) throws java.io.IOException {
        try (InputStream body = response.body()) {
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new InvoiceDocumentUnavailableException();
            byte[] content = body.readNBytes(MAX_OBJECT_BYTES + 1);
            if (content.length == 0 || content.length > MAX_OBJECT_BYTES) throw new InvoiceDocumentUnavailableException();
            return content;
        }
    }

    private static void addHeaders(HttpRequest.Builder request, Map<String, String> headers) {
        headers.forEach((name, value) -> {
            if (!"host".equalsIgnoreCase(name)) request.header(name, value);
        });
    }
}
