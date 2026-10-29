package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class R2PresignedUrlSignerTest {
    private final R2PresignedUrlSigner signer = new R2PresignedUrlSigner();

    @Test
    void presignGet_matchesAwsDocumentedS3ExampleVector() {
        var now = Instant.parse("2013-05-24T00:00:00Z");
        var signed = signer.presignGet(URI.create("https://examplebucket.s3.amazonaws.com/test.txt"),
                "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", now, 86400, java.util.Map.of());
        assertThat(signed.url()).isEqualTo("https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256"
                + "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request"
                + "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host"
                + "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    }

    @Test
    void presignR2Get_usesConfiguredTtlAndAddsInlineResponseOverrides() {
        var now = Instant.parse("2026-10-27T12:00:00Z");
        var properties = new R2StorageProperties(true, "billing-pliego",
                "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "auto",
                "fictional-access", "fictional-secret", "240", "invoices/");
        properties.validate();
        var signed = signer.presignR2Get(properties, "invoices/42/ab12.pdf", "application/pdf",
                "inline; filename=\"factura-999-999-000000042.pdf\"", now);
        assertThat(signed.url()).startsWith("https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/billing-pliego/invoices/42/ab12.pdf?");
        assertThat(signed.url()).contains("X-Amz-Credential=fictional-access%2F20261027%2Fauto%2Fs3%2Faws4_request",
                "X-Amz-Expires=240", "response-content-type=application%2Fpdf",
                "response-content-disposition=inline%3B%20filename%3D%22factura-999-999-000000042.pdf%22");
        assertThat(signed.expiresInSeconds()).isEqualTo(240);
        assertThat(signed.expiresAt()).isEqualTo(now.plusSeconds(240));
        assertThat(signed.toString()).doesNotContain("fictional-secret").contains("REDACTED");
        var capped = signer.presignR2Get(properties, "invoices/42/ab12.pdf", "application/pdf",
                "inline; filename=\"factura-999-999-000000042.pdf\"", 900, now);
        assertThat(capped.expiresInSeconds()).isEqualTo(300);
        assertThat(capped.url()).contains("X-Amz-Expires=300");
    }

    @Test
    void presignR2Get_signsDispositionAndQuotedFilenameForBothPresentationModes() {
        var now = Instant.parse("2026-10-27T12:00:00Z");
        var properties = new R2StorageProperties(true, "billing-pliego",
                "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "auto",
                "fictional-access", "fictional-secret", "300", "invoices/");
        var inline = signer.presignR2Get(properties, "invoices/42/ab12.pdf", "application/pdf",
                "inline; filename=\"factura-999-999-000000042.pdf\"", now);
        var attachment = signer.presignR2Get(properties, "invoices/42/ab12.pdf", "application/pdf",
                "attachment; filename=\"factura-999-999-000000042.pdf\"", now);

        assertThat(inline.url()).contains("response-content-type=application%2Fpdf",
                "response-content-disposition=inline%3B%20filename%3D%22factura-999-999-000000042.pdf%22");
        assertThat(attachment.url()).contains("response-content-type=application%2Fpdf",
                "response-content-disposition=attachment%3B%20filename%3D%22factura-999-999-000000042.pdf%22");
        assertThat(queryValue(inline.url(), "X-Amz-Signature"))
                .isNotEqualTo(queryValue(attachment.url(), "X-Amz-Signature"));
        assertThat(inline.expiresInSeconds()).isEqualTo(300);
        assertThat(attachment.expiresInSeconds()).isEqualTo(300);
    }

    @Test
    void presignR2Get_exactConfiguredExpiryUsesDatePlusExactlyThreeHundredSeconds() {
        var now = Instant.parse("2026-10-27T12:00:00Z");
        var properties = new R2StorageProperties(true, "billing-pliego",
                "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "auto",
                "fictional-access", "fictional-secret", "300", "invoices/");
        var signed = signer.presignR2Get(properties, "invoices/42/ab12.pdf", "application/pdf",
                "attachment; filename=\"factura-999-999-000000042.pdf\"", now);
        var signedAt = Instant.from(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'")
                .withZone(java.time.ZoneOffset.UTC).parse(queryValue(signed.url(), "X-Amz-Date")));
        assertThat(queryValue(signed.url(), "X-Amz-Expires")).isEqualTo("300");
        assertThat(signed.expiresAt()).isEqualTo(signedAt.plusSeconds(300));
        assertThat(signed.expiresAt()).isEqualTo(Instant.parse("2026-10-27T12:05:00Z"));
    }

    @Test
    void presignR2Get_subSecondClockNeverOverstatesTheSignedExpiry() {
        var now = Instant.parse("2026-10-27T12:00:00.987654321Z");
        var properties = new R2StorageProperties(true, "billing-pliego",
                "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "auto",
                "fictional-access", "fictional-secret", "300", "invoices/");
        var signed = signer.presignR2Get(properties, "invoices/42/ab12.pdf", "application/pdf",
                "inline; filename=\"factura-999-999-000000042.pdf\"", now);
        assertThat(queryValue(signed.url(), "X-Amz-Date")).isEqualTo("20261027T120000Z");
        assertThat(signed.expiresAt()).isEqualTo(Instant.parse("2026-10-27T12:05:00Z"));
    }

    private static String queryValue(String url, String name) {
        return java.util.Arrays.stream(java.net.URI.create(url).getRawQuery().split("&"))
                .filter(pair -> pair.startsWith(name + "="))
                .map(pair -> java.net.URLDecoder.decode(pair.substring(name.length() + 1), java.nio.charset.StandardCharsets.UTF_8))
                .findFirst().orElseThrow();
    }
}
