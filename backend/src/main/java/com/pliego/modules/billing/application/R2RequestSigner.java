package com.pliego.modules.billing.application;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/** Header-based, payload-signed AWS Signature V4 using only JDK crypto and URI APIs. */
@Component
public final class R2RequestSigner {
    private static final DateTimeFormatter AMZ_DATE = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter SHORT_DATE = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC);
    public SignedRequest sign(String method, URI endpoint, String accessKeyId, String secretAccessKey,
            String region, Instant now, byte[] payload, Map<String, String> additionalHeaders) {
        validate(method, endpoint, accessKeyId, secretAccessKey, region, now, payload, additionalHeaders);
        String host = endpoint.getHost().toLowerCase(java.util.Locale.ROOT)
                + (endpoint.getPort() < 0 || endpoint.getPort() == 443 ? "" : ":" + endpoint.getPort());
        String payloadHash = sha256(payload);
        String timestamp = AMZ_DATE.format(now);
        String date = SHORT_DATE.format(now);
        String scope = date + "/" + region + "/s3/aws4_request";
        TreeMap<String, String> headers = new TreeMap<>();
        headers.put("host", host);
        headers.put("x-amz-content-sha256", payloadHash);
        headers.put("x-amz-date", timestamp);
        additionalHeaders.forEach((name, value) -> headers.put(name.toLowerCase(java.util.Locale.ROOT), normalize(value)));

        String canonicalHeaders = headers.entrySet().stream()
                .map(entry -> entry.getKey() + ":" + normalize(entry.getValue()) + "\n")
                .collect(java.util.stream.Collectors.joining());
        String signedHeaders = headers.keySet().stream().sorted(Comparator.naturalOrder())
                .collect(java.util.stream.Collectors.joining(";"));
        String canonicalRequest = method.toUpperCase(java.util.Locale.ROOT) + "\n" + canonicalPath(endpoint.getRawPath())
                + "\n" + canonicalQuery(endpoint) + "\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
        String toSign = "AWS4-HMAC-SHA256\n" + timestamp + "\n" + scope + "\n" + sha256(canonicalRequest.getBytes(StandardCharsets.UTF_8));
        byte[] signingKey = hmac(hmac(hmac(hmac(("AWS4" + secretAccessKey).getBytes(StandardCharsets.UTF_8), date),
                region), "s3"), "aws4_request");
        String signature = HexFormat.of().formatHex(hmac(signingKey, toSign.getBytes(StandardCharsets.UTF_8)));
        String authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + scope
                + ",SignedHeaders=" + signedHeaders + ",Signature=" + signature;
        TreeMap<String, String> result = new TreeMap<>(headers);
        result.put("Authorization", authorization);
        return new SignedRequest(Map.copyOf(result), payloadHash);
    }

    private static void validate(String method, URI endpoint, String accessKeyId, String secretAccessKey,
            String region, Instant now, byte[] payload, Map<String, String> headers) {
        if (method == null || !method.matches("GET|PUT|DELETE") || endpoint == null
                || !"https".equalsIgnoreCase(endpoint.getScheme()) || endpoint.getHost() == null
                || endpoint.getRawUserInfo() != null || endpoint.getRawQuery() != null || endpoint.getRawFragment() != null
                || accessKeyId == null || accessKeyId.isBlank() || secretAccessKey == null || secretAccessKey.isBlank()
                || region == null || region.isBlank() || now == null || payload == null || headers == null)
            throw new IllegalArgumentException("Parámetros SigV4 inválidos para R2.");
        for (var entry : headers.entrySet()) {
            String name = entry.getKey();
            String value = entry.getValue();
            if (name == null || !name.matches("[A-Za-z0-9-]+") || value == null || unsafe(value)
                    || name.equalsIgnoreCase("host") || name.equalsIgnoreCase("authorization")
                    || name.equalsIgnoreCase("x-amz-date") || name.equalsIgnoreCase("x-amz-content-sha256"))
                throw new IllegalArgumentException("Encabezados SigV4 inválidos para R2.");
        }
    }

    private static String canonicalQuery(URI uri) { return uri.getRawQuery() == null ? "" : uri.getRawQuery(); }

    static String canonicalPath(String rawPath) {
        if (rawPath == null || rawPath.isEmpty()) return "/";
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < rawPath.length();) {
            char current = rawPath.charAt(i);
            if (current == '/') { result.append('/'); i++; continue; }
            if (current == '%' && i + 2 < rawPath.length()
                    && Character.digit(rawPath.charAt(i + 1), 16) >= 0
                    && Character.digit(rawPath.charAt(i + 2), 16) >= 0) {
                result.append('%').append(Character.toUpperCase(rawPath.charAt(i + 1)))
                        .append(Character.toUpperCase(rawPath.charAt(i + 2)));
                i += 3;
                continue;
            }
            int codePoint = rawPath.codePointAt(i);
            result.append(encode(new String(Character.toChars(codePoint))));
            i += Character.charCount(codePoint);
        }
        return result.toString();
    }

    static String encode(String value) {
        StringBuilder result = new StringBuilder();
        for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || c == '-' || c == '_' || c == '.' || c == '~') result.append((char) c);
            else result.append('%').append("0123456789ABCDEF".charAt(c >>> 4)).append("0123456789ABCDEF".charAt(c & 15));
        }
        return result.toString();
    }

    private static String normalize(String value) { return value.trim().replaceAll("\\s+", " "); }
    private static boolean unsafe(String value) { return value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0; }

    private static String sha256(byte[] value) {
        try { return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value)); }
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

    public record SignedRequest(Map<String, String> headers, String payloadHash) {
        @Override public String toString() { return "SignedRequest[headers=REDACTED, payloadHash=" + payloadHash + "]"; }
    }
}
