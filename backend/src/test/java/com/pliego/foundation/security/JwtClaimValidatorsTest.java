package com.pliego.foundation.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.oauth2.jwt.Jwt;

class JwtClaimValidatorsTest {
    private static final Instant NOW = Instant.parse("2026-11-02T12:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private final JwtConfiguration validators = new JwtConfiguration();

    @ParameterizedTest
    @ValueSource(strings = {"1", "9223372036854775807"})
    void subject_whenCanonicalPositiveLong_accepts(String value) {
        assertThat(validators.subjectValidator().validate(claim("sub", value)).hasErrors()).isFalse();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"0", "-1", "+1", "01", "1.0", " 1", "1 ", "one", "9223372036854775808", "١"})
    void subject_whenNotCanonicalPositiveLong_rejects(String value) {
        assertThat(validators.subjectValidator().validate(claim("sub", value)).hasErrors()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"CUSTOMER", "ADMIN"})
    void role_whenApproved_accepts(String value) {
        assertThat(validators.roleValidator().validate(claim("role", value)).hasErrors()).isFalse();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"OWNER", "customer", "ROLE_ADMIN"})
    void role_whenUnknownOrMissing_rejects(String value) {
        assertThat(validators.roleValidator().validate(claim("role", value)).hasErrors()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"123e4567-e89b-12d3-a456-426614174000", "123E4567-E89B-12D3-A456-426614174000"})
    void tokenId_whenFullUuid_accepts(String value) {
        assertThat(validators.tokenIdValidator().validate(claim("jti", value)).hasErrors()).isFalse();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"1-1-1-1-1", "invalid", "123e4567e89b12d3a456426614174000"})
    void tokenId_whenNotFullUuid_rejects(String value) {
        assertThat(validators.tokenIdValidator().validate(claim("jti", value)).hasErrors()).isTrue();
    }

    @Test
    void issuedAt_whenMissingOrOneNanosecondInFuture_rejectsWithoutSkew() {
        assertThat(validators.issuedAtValidator(CLOCK).validate(claim("iat", null)).hasErrors()).isTrue();
        assertThat(validators.issuedAtValidator(CLOCK).validate(claim("iat", NOW.plusNanos(1))).hasErrors()).isTrue();
        assertThat(validators.issuedAtValidator(CLOCK).validate(claim("iat", NOW)).hasErrors()).isFalse();
        assertThat(validators.issuedAtValidator(CLOCK).validate(claim("iat", NOW.minusSeconds(1))).hasErrors()).isFalse();
    }

    @Test
    void lifetime_whenExactlyThirtyMinutes_acceptsWithoutProvingFreshness() {
        var token = Jwt.withTokenValue("unit").header("alg", "HS256")
                .issuedAt(NOW.minusSeconds(3 * 24 * 60 * 60))
                .expiresAt(NOW.minusSeconds(3 * 24 * 60 * 60).plusSeconds(1800)).build();
        assertThat(validators.lifetimeValidator().validate(token).hasErrors()).isFalse();
    }

    @ParameterizedTest
    @ValueSource(longs = {1799, 1801})
    void lifetime_whenNotExactlyThirtyMinutes_rejects(long seconds) {
        var token = Jwt.withTokenValue("unit").header("alg", "HS256")
                .issuedAt(NOW).expiresAt(NOW.plusSeconds(seconds)).build();
        assertThat(validators.lifetimeValidator().validate(token).hasErrors()).isTrue();
    }

    @Test
    void lifetime_whenSubsecondDifferenceOrMissingTimestamp_rejects() {
        var token = Jwt.withTokenValue("unit").header("alg", "HS256")
                .issuedAt(NOW).expiresAt(NOW.plusSeconds(1800).plusNanos(1)).build();
        assertThat(validators.lifetimeValidator().validate(token).hasErrors()).isTrue();
        assertThat(validators.lifetimeValidator().validate(claim("iat", null)).hasErrors()).isTrue();
        assertThat(validators.lifetimeValidator().validate(claim("exp", null)).hasErrors()).isTrue();
    }

    @ParameterizedTest
    @MethodSource("audiences")
    void audience_acceptsOnlyExactAudience(AudienceCase test) {
        assertThat(validators.audienceValidator().validate(claim("aud", test.value())).hasErrors())
                .isEqualTo(test.invalid());
    }

    record AudienceCase(Object value, boolean invalid) {}

    static Stream<AudienceCase> audiences() {
        return Stream.of(new AudienceCase("pliego-api", false), new AudienceCase(List.of("pliego-api"), false),
                new AudienceCase("wrong", true), new AudienceCase(List.of(), true),
                new AudienceCase(List.of("pliego-api", "wrong"), true),
                new AudienceCase(List.of("pliego-api", "pliego-api"), true), new AudienceCase(null, true));
    }

    private Jwt claim(String name, Object value) {
        Map<String, Object> claims = new LinkedHashMap<>(Map.of("sub", "1", "role", "CUSTOMER",
                "jti", "123e4567-e89b-12d3-a456-426614174000", "aud", "pliego-api",
                "iat", NOW, "exp", NOW.plusSeconds(1800)));
        if (value == null) claims.remove(name); else claims.put(name, value);
        return Jwt.withTokenValue("unit").header("alg", "HS256").claims(c -> c.putAll(claims)).build();
    }
}
