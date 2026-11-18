package com.pliego.foundation.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import javax.crypto.spec.SecretKeySpec;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

class JwtTokenIssuerTest {
    @ParameterizedTest
    @ValueSource(strings = {"CUSTOMER", "ADMIN"})
    void issue_usesContractClaimsHs256AndExactlyThirtyMinutesFromSuppliedClock(String role) throws Exception {
        var key = new SecretKeySpec("local-jwt-issuer-test-secret-at-least-32-bytes".getBytes(StandardCharsets.US_ASCII), "HmacSHA256");
        var issuedAt = Instant.parse("2026-11-02T12:00:00.999999999Z");
        String compact = new JwtTokenIssuer(key).issue("7", role, issuedAt, issuedAt.plusSeconds(1800), "123e4567-e89b-12d3-a456-426614174000");
        var signed = SignedJWT.parse(compact);
        assertThat(signed.getHeader().getAlgorithm()).isEqualTo(JWSAlgorithm.HS256);
        assertThat(signed.getHeader().getType()).isEqualTo(JOSEObjectType.JWT);
        var claims = signed.getPayload().toJSONObject();
        assertThat(claims).containsOnlyKeys("iss", "aud", "sub", "role", "iat", "exp", "jti");
        assertThat(claims).containsEntry("iss", "pliego").containsEntry("aud", "pliego-api")
                .containsEntry("sub", "7").containsEntry("role", role)
                .containsEntry("iat", 1793620800L).containsEntry("exp", 1793622600L)
                .containsEntry("jti", "123e4567-e89b-12d3-a456-426614174000");
        var jwt = new JwtConfiguration().jwtDecoder(key, Clock.fixed(issuedAt, ZoneOffset.UTC)).decode(compact);
        assertThat(jwt.getIssuedAt()).isEqualTo(Instant.parse("2026-11-02T12:00:00Z"));
        assertThat(jwt.getExpiresAt()).isEqualTo(Instant.parse("2026-11-02T12:30:00Z"));
    }

    @Test
    void issue_whenCallerSuppliesDifferentLifetime_rejectsBeforeSigning() {
        var key = new SecretKeySpec(new byte[32], "HmacSHA256");
        var issuedAt = Instant.parse("2026-11-02T12:00:00Z");
        assertThatThrownBy(() -> new JwtTokenIssuer(key).issue("7", "CUSTOMER", issuedAt,
                issuedAt.plusSeconds(1801), "123e4567-e89b-12d3-a456-426614174000"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
