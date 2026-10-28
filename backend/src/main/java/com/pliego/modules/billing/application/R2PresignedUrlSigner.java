package com.pliego.modules.billing.application;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/** JDK-only SigV4 query presigner for private R2 GETs; it never performs network requests. */
@Component
public final class R2PresignedUrlSigner {
    private static final DateTimeFormatter AMZ_DATE = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter SHORT_DATE = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC);
    private static final int MAX_R2_EXPIRY_SECONDS = 300;

    public PresignedUrl presignR2Get(R2StorageProperties properties, String objectKey, String responseContentType,
            String responseContentDisposition, Instant now) {
        properties.validate();
        if (!properties.enabled() || objectKey == null || objectKey.isBlank() || responseContentType == null
                || responseContentDisposition == null || now == null)
            throw new IllegalArgumentException("No se pudo preparar el acceso privado al documento.");
        return presignR2Get(properties, objectKey, responseContentType, responseContentDisposition,
                properties.ttlSeconds(), now);
    }

    /** Defensive clamp for internal callers; configured values are separately rejected outside 1..300. */
    PresignedUrl presignR2Get(R2StorageProperties properties, String objectKey, String responseContentType,
            String responseContentDisposition, int requestedTtlSeconds, Instant now) {
        properties.validate();
        if (!properties.enabled()) throw new IllegalArgumentException("El acceso R2 está deshabilitado.");
        int ttl = Math.max(1, Math.min(MAX_R2_EXPIRY_SECONDS, requestedTtlSeconds));
        try {
            URI root = properties.endpointUri();
            URI object = new URI(root.getScheme(), null, root.getHost(), root.getPort(),
                    "/" + properties.bucket() + "/" + objectKey, null, null);
            Map<String, String> overrides = Map.of(
                    "response-content-type", responseContentType,
                    "response-content-disposition", responseContentDisposition);
            return presignGet(object, properties.accessKeyId(), properties.secretAccessKey(), properties.region(), now, ttl, overrides);
        } catch (java.net.URISyntaxException malformed) {
            throw new IllegalArgumentException("No se pudo preparar el acceso privado al documento.");
        }
    }

    /** Test seam for AWS's published canonical S3 presigned-URL vector. */
    PresignedUrl presignGet(URI endpoint, String accessKeyId, String secretAccessKey, String region,
            Instant now, int expiresInSeconds, Map<String, String> additionalQuery) {
        validate(endpoint, accessKeyId, secretAccessKey, region, now, expiresInSeconds, additionalQuery);
        // X-Amz-Date has whole seconds and R2 counts the TTL from it; expiresAt must use the same instant.
        now = now.truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        String host = endpoint.getHost().toLowerCase(java.util.Locale.ROOT)
                + (endpoint.getPort() < 0 || endpoint.getPort() == 443 ? "" : ":" + endpoint.getPort());
        String path = R2RequestSigner.canonicalPath(endpoint.getRawPath());
        String date = SHORT_DATE.format(now);
        String timestamp = AMZ_DATE.format(now);
        String scope = date + "/" + region + "/s3/aws4_request";
        List<QueryParameter> parameters = new ArrayList<>();
        parameters.add(new QueryParameter("X-Amz-Algorithm", "AWS4-HMAC-SHA256"));
        parameters.add(new QueryParameter("X-Amz-Credential", accessKeyId + "/" + scope));
        parameters.add(new QueryParameter("X-Amz-Date", timestamp));
        parameters.add(new QueryParameter("X-Amz-Expires", Integer.toString(expiresInSeconds)));
        parameters.add(new QueryParameter("X-Amz-SignedHeaders", "host"));
        additionalQuery.forEach((name, value) -> parameters.add(new QueryParameter(name, value)));
        String canonicalQuery = canonicalQuery(parameters);
        String canonicalRequest = "GET\n" + path + "\n" + canonicalQuery + "\n"
                + "host:" + host + "\n\n" + "host\nUNSIGNED-PAYLOAD";
        String toSign = "AWS4-HMAC-SHA256\n" + timestamp + "\n" + scope + "\n" + sha256(canonicalRequest);
        byte[] signingKey = hmac(hmac(hmac(hmac(("AWS4" + secretAccessKey).getBytes(StandardCharsets.UTF_8), date),
                region), "s3"), "aws4_request");
        String signature = HexFormat.of().formatHex(hmac(signingKey, toSign));
        String url = endpoint.getScheme() + "://" + endpoint.getRawAuthority() + path + "?"
                + canonicalQuery + "&X-Amz-Signature=" + signature;
        return new PresignedUrl(url, now.plusSeconds(expiresInSeconds), expiresInSeconds);
    }

    private static void validate(URI endpoint, String accessKeyId, String secretAccessKey,
            String region, Instant now, int expiresInSeconds, Map<String, String> additionalQuery) {
        if (endpoint == null || !"https".equalsIgnoreCase(endpoint.getScheme()) || endpoint.getHost() == null
                || endpoint.getRawUserInfo() != null || endpoint.getRawQuery() != null || endpoint.getRawFragment() != null
                || accessKeyId == null || accessKeyId.isBlank() || secretAccessKey == null || secretAccessKey.isBlank()
                || region == null || region.isBlank() || now == null || expiresInSeconds < 1 || expiresInSeconds > 604800
                || additionalQuery == null)
            throw new IllegalArgumentException("Parámetros SigV4 inválidos para acceso privado.");
    }

    private static String canonicalQuery(List<QueryParameter> parameters) {
        return parameters.stream()
                .map(parameter -> new EncodedParameter(encode(parameter.name()), encode(parameter.value())))
                .sorted(Comparator.comparing(EncodedParameter::name).thenComparing(EncodedParameter::value))
                .map(parameter -> parameter.name() + "=" + parameter.value())
                .collect(java.util.stream.Collectors.joining("&"));
    }

    private static String encode(String value) { return R2RequestSigner.encode(value); }

    private static String sha256(String value) {
        try { return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 no está disponible."); }
    }

    private static byte[] hmac(byte[] key, String value) { return hmac(key, value.getBytes(StandardCharsets.UTF_8)); }
    private static byte[] hmac(byte[] key, byte[] value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(value);
        } catch (java.security.GeneralSecurityException failure) {
            throw new IllegalStateException("HmacSHA256 no está disponible.");
        }
    }

    private record QueryParameter(String name, String value) { }
    private record EncodedParameter(String name, String value) { }

    public record PresignedUrl(String url, Instant expiresAt, int expiresInSeconds) {
        @Override public String toString() {
            return "PresignedUrl[url=REDACTED, expiresAt=" + expiresAt + ", expiresInSeconds=" + expiresInSeconds + "]";
        }
    }
}
