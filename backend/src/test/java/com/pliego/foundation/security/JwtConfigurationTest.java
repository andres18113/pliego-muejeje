package com.pliego.foundation.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.Stream;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSObject;
import com.nimbusds.jose.Payload;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.JWTClaimsSet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

class JwtConfigurationTest {
    private static final String TOKEN_ID = "123e4567-e89b-12d3-a456-426614174000";
    private static final SecretKey KEY = new SecretKeySpec(
            "local-jwt-review-key-with-at-least-sixty-four-bytes-0123456789abcdef".getBytes(StandardCharsets.US_ASCII),
            "HmacSHA256");
    private final Instant now = Instant.parse("2026-11-02T12:00:00Z");
    private final JwtDecoder decoder = new JwtConfiguration().jwtDecoder(KEY, Clock.fixed(now, ZoneOffset.UTC));

    @ParameterizedTest
    @MethodSource("validAudiences")
    void decoder_whenAudienceHasExactlyOneApprovedValue_acceptsRealSignedToken(Object audience) throws Exception {
        var claims = claims();
        claims.put("aud", audience);
        var jwt = decoder.decode(sign(claims, JWSAlgorithm.HS256));
        assertThat(jwt.getSubject()).isEqualTo("7");
        assertThat(jwt.getAudience()).containsExactly("pliego-api");
    }

    static Stream<Object> validAudiences() { return Stream.of("pliego-api", List.of("pliego-api")); }

    record Violation(String name, Consumer<Map<String, Object>> change) {
        @Override public String toString() { return name; }
    }

    static Stream<Violation> violations() {
        return Stream.of(
                missing("iss"), changed("wrong issuer", "iss", "other"),
                missing("sub"), changed("zero subject", "sub", "0"),
                changed("negative subject", "sub", "-1"), changed("leading zero", "sub", "01"),
                changed("signed subject", "sub", "+7"), changed("decimal subject", "sub", "7.0"),
                changed("whitespace subject", "sub", " 7"), changed("nondecimal subject", "sub", "seven"),
                changed("overflow subject", "sub", "9223372036854775808"),
                missing("role"), changed("unknown role", "role", "OWNER"),
                changed("lowercase role", "role", "customer"), changed("nonstring role", "role", 7),
                missing("jti"), changed("invalid UUID", "jti", "invalid"),
                changed("abbreviated UUID", "jti", "1-1-1-1-1"),
                changed("UUID without separators", "jti", "123e4567e89b12d3a456426614174000"),
                missing("iat"), missing("exp"), missing("aud"),
                changed("wrong audience", "aud", "other"), changed("empty audience", "aud", List.of()),
                changed("multi audience", "aud", List.of("pliego-api", "other")),
                changed("duplicate audience", "aud", List.of("pliego-api", "pliego-api")),
                new Violation("short lifetime", c -> c.put("exp", (long)c.get("iat") + 1799)),
                new Violation("long lifetime", c -> c.put("exp", (long)c.get("iat") + 1801)),
                new Violation("zero lifetime", c -> c.put("exp", c.get("iat"))),
                new Violation("negative lifetime", c -> c.put("exp", (long)c.get("iat") - 1)));
    }

    private static Violation missing(String claim) { return new Violation("missing " + claim, c -> c.remove(claim)); }
    private static Violation changed(String name, String claim, Object value) {
        return new Violation(name, c -> c.put(claim, value));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("violations")
    void decoder_whenClaimViolatesContract_rejectsRealSignedToken(Violation violation) throws Exception {
        var claims = claims();
        violation.change().accept(claims);
        assertRejected(sign(claims, JWSAlgorithm.HS256));
    }

    @Test
    void decoder_whenIssuedThreeDaysAgoWithExactlyThirtyMinuteLifetime_rejectsExpiredToken() throws Exception {
        var claims = claims();
        claims.put("iat", now.minusSeconds(3 * 24 * 60 * 60).getEpochSecond());
        claims.put("exp", (long)claims.get("iat") + 1800);
        assertRejected(sign(claims, JWSAlgorithm.HS256));
    }

    @Test
    void decoder_whenExpiredOneSecondAgo_rejectsWithoutClockSkew() throws Exception {
        var claims = claims();
        claims.put("exp", now.minusSeconds(1).getEpochSecond());
        claims.put("iat", (long)claims.get("exp") - 1800);
        assertRejected(sign(claims, JWSAlgorithm.HS256));
    }

    @Test
    void decoder_whenIssuedInFuture_rejectsEvenWithValidLifetime() throws Exception {
        var claims = claims();
        claims.put("iat", now.plusSeconds(1).getEpochSecond());
        claims.put("exp", (long)claims.get("iat") + 1800);
        assertRejected(sign(claims, JWSAlgorithm.HS256));
    }

    @Test
    void decoder_whenNotBeforeIsInFuture_rejectsWithoutClockSkew() throws Exception {
        var claims = claims();
        claims.put("nbf", now.plusSeconds(1).getEpochSecond());
        assertRejected(sign(claims, JWSAlgorithm.HS256));
    }

    @Test
    void decoder_whenAlgorithmIsHs512_rejectsEvenWithValidSignature() throws Exception {
        assertRejected(sign(claims(), JWSAlgorithm.HS512));
    }

    @Test
    void decoder_whenAlgorithmIsNone_rejectsUnsignedToken() throws Exception {
        assertRejected(new PlainJWT(JWTClaimsSet.parse(claims())).serialize());
    }

    @Test
    void decoder_whenSignatureIsFromAnotherKey_rejects() throws Exception {
        var object = new JWSObject(new JWSHeader(JWSAlgorithm.HS256), new Payload(claims()));
        object.sign(new MACSigner(new byte[64]));
        assertRejected(object.serialize());
    }

    private Map<String, Object> claims() {
        return new LinkedHashMap<>(Map.of("iss", "pliego", "aud", "pliego-api", "sub", "7",
                "role", "CUSTOMER", "jti", TOKEN_ID,
                "iat", now.minusSeconds(1).getEpochSecond(), "exp", now.plusSeconds(1799).getEpochSecond()));
    }

    private String sign(Map<String, Object> claims, JWSAlgorithm algorithm) throws Exception {
        var object = new JWSObject(new JWSHeader.Builder(algorithm).type(JOSEObjectType.JWT).build(), new Payload(claims));
        object.sign(new MACSigner(KEY));
        return object.serialize();
    }

    private void assertRejected(String token) {
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }
}
