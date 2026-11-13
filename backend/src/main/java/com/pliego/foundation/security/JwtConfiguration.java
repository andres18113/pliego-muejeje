package com.pliego.foundation.security;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

@Configuration
public class JwtConfiguration {

    private static final OAuth2Error INVALID_TOKEN = new OAuth2Error("invalid_token", "Invalid access token", null);

    @Bean
    SecretKey pliegoJwtSecretKey(@Value("${pliego.security.jwt.secret}") String secret) {
        byte[] secretBytes = secret.getBytes(StandardCharsets.UTF_8);
        if (secretBytes.length < 32) {
            throw new IllegalStateException("PLIEGO_JWT_SECRET must contain at least 32 UTF-8 bytes");
        }
        return new SecretKeySpec(secretBytes, "HmacSHA256");
    }

    @Bean
    JwtDecoder jwtDecoder(SecretKey pliegoJwtSecretKey) {
        return jwtDecoder(pliegoJwtSecretKey, Clock.systemUTC());
    }

    JwtDecoder jwtDecoder(SecretKey pliegoJwtSecretKey, Clock clock) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(pliegoJwtSecretKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        JwtTimestampValidator timestamps = new JwtTimestampValidator(Duration.ZERO);
        timestamps.setClock(clock);
        timestamps.setAllowEmptyExpiryClaim(false);
        var validators = new DelegatingOAuth2TokenValidator<>(
                new JwtIssuerValidator(JwtAccessTokenClaims.ISSUER),
                timestamps,
                audienceValidator(),
                requiredClaimsValidator(clock));
        // Built-in validators have diagnostic descriptions; expose one uniform failure.
        decoder.setJwtValidator(jwt -> validators.validate(jwt).hasErrors()
                ? OAuth2TokenValidatorResult.failure(INVALID_TOKEN)
                : OAuth2TokenValidatorResult.success());
        return decoder;
    }

    OAuth2TokenValidator<Jwt> audienceValidator() {
        // JwtAudienceValidator allows additional audiences; this contract requires exactly one.
        return new JwtClaimValidator<Object>("aud", audience ->
                JwtAccessTokenClaims.AUDIENCE.equals(audience)
                        || List.of(JwtAccessTokenClaims.AUDIENCE).equals(audience));
    }

    OAuth2TokenValidator<Jwt> requiredClaimsValidator(Clock clock) {
        return new DelegatingOAuth2TokenValidator<>(subjectValidator(), roleValidator(), tokenIdValidator(),
                issuedAtValidator(clock), lifetimeValidator());
    }

    OAuth2TokenValidator<Jwt> subjectValidator() {
        return new JwtClaimValidator<Object>("sub", value -> {
            if (!(value instanceof String subject)) return false;
            try {
                long id = Long.parseLong(subject);
                return id > 0 && Long.toString(id).equals(subject);
            } catch (NumberFormatException ignored) {
                return false;
            }
        });
    }

    OAuth2TokenValidator<Jwt> roleValidator() {
        return new JwtClaimValidator<Object>("role", JwtAccessTokenClaims.ROLES::contains);
    }

    OAuth2TokenValidator<Jwt> tokenIdValidator() {
        return new JwtClaimValidator<Object>("jti", value -> value instanceof String id && isUuid(id));
    }

    OAuth2TokenValidator<Jwt> issuedAtValidator(Clock clock) {
        return new JwtClaimValidator<java.time.Instant>("iat", issuedAt -> !issuedAt.isAfter(clock.instant()));
    }

    OAuth2TokenValidator<Jwt> lifetimeValidator() {
        return jwt -> jwt.getIssuedAt() != null && jwt.getExpiresAt() != null
                && Duration.between(jwt.getIssuedAt(), jwt.getExpiresAt()).equals(JwtAccessTokenClaims.LIFETIME)
                        ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
    }

    private boolean isUuid(String value) {
        try {
            return UUID.fromString(value).toString().equalsIgnoreCase(value);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }
}
