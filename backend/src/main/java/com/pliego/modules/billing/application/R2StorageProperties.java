package com.pliego.modules.billing.application;

import java.net.URI;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Values bound from PLIEGO_R2_*; validation is deliberately deferred while R2 is disabled. */
@ConfigurationProperties("pliego.r2")
public record R2StorageProperties(
        @DefaultValue("false") boolean enabled,
        String bucket,
        String endpoint,
        @DefaultValue("auto") String region,
        String accessKeyId,
        String secretAccessKey,
        @DefaultValue("300") String presignTtlSeconds,
        @DefaultValue("invoices/") String keyPrefix) {

    public void validate() {
        if (!enabled) return;
        if (bucket == null || !bucket.matches("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]")) throw invalid();
        if (endpoint == null || endpoint.isBlank()) throw invalid();
        URI uri;
        try { uri = URI.create(endpoint); }
        catch (IllegalArgumentException malformed) { throw invalid(); }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty()) || uri.getRawQuery() != null
                || uri.getRawFragment() != null) throw invalid();
        if (region == null || region.isBlank() || unsafe(region)) throw invalid();
        if (accessKeyId == null || accessKeyId.isBlank() || unsafe(accessKeyId)
                || secretAccessKey == null || secretAccessKey.isBlank() || unsafe(secretAccessKey)) throw invalid();
        int ttlSeconds = ttlSeconds();
        if (ttlSeconds < 1 || ttlSeconds > 300) throw invalid();
        if (keyPrefix == null || !keyPrefix.endsWith("/") || keyPrefix.startsWith("/") || keyPrefix.length() > 900
                || keyPrefix.contains("..") || keyPrefix.contains("\\") || keyPrefix.contains("?")
                || keyPrefix.contains("#") || !keyPrefix.matches("[A-Za-z0-9._/-]+")) throw invalid();
        for (String segment : keyPrefix.substring(0, keyPrefix.length() - 1).split("/"))
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) throw invalid();
    }

    public URI endpointUri() {
        validate();
        return URI.create(endpoint);
    }

    public int ttlSeconds() {
        try { return Integer.parseInt(presignTtlSeconds); }
        catch (NumberFormatException invalidTtl) { throw invalid(); }
    }

    private static boolean unsafe(String value) { return value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0; }
    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Configura PLIEGO_R2_BUCKET, ENDPOINT, REGION, credenciales, TTL y prefijo válidos.");
    }

    @Override public String toString() {
        return "R2StorageProperties[enabled=" + enabled + ", bucket=" + bucket + ", endpoint=" + endpoint
                + ", region=" + region + ", credentials=REDACTED, presignTtlSeconds=" + presignTtlSeconds
                + ", keyPrefix=" + keyPrefix + "]";
    }
}
