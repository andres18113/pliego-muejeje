package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Operator-run only. Never run as part of normal verification; the object is always deleted in finally. */
@EnabledIfEnvironmentVariable(named = "PLIEGO_R2_LIVE_TEST", matches = "true")
class R2LiveSmokeTest {
    @Test
    void putPresignFetchAndDeleteOnePrivateSmokeObject() {
        var properties = new R2StorageProperties(true,
                System.getenv("PLIEGO_R2_BUCKET"), System.getenv("PLIEGO_R2_ENDPOINT"),
                valueOr("PLIEGO_R2_REGION", "auto"), System.getenv("PLIEGO_R2_ACCESS_KEY_ID"),
                System.getenv("PLIEGO_R2_SECRET_ACCESS_KEY"), valueOr("PLIEGO_R2_PRESIGN_TTL_SECONDS", "300"),
                valueOr("PLIEGO_R2_KEY_PREFIX", "invoices/"));
        properties.validate();
        var signer = new R2PresignedUrlSigner();
        var client = new R2ObjectClient(properties, new R2RequestSigner());
        String key = properties.keyPrefix() + "smoke/" + UUID.randomUUID() + ".txt";
        byte[] expected = "PLIEGO private storage smoke".getBytes(StandardCharsets.UTF_8);
        try {
            client.putObject(key, expected, "text/plain");
            var signed = signer.presignR2Get(properties, key, "text/plain", "inline; filename=smoke.txt", Instant.now());
            assertThat(client.getPresignedObject(URI.create(signed.url()))).containsExactly(expected);
        } finally {
            client.deleteObject(key);
        }
    }

    private static String valueOr(String variable, String fallback) {
        String value = System.getenv(variable);
        return value == null || value.isBlank() ? fallback : value;
    }
}
