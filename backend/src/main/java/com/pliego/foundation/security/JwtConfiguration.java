package com.pliego.foundation.security;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Collection;
import java.util.regex.Pattern;

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
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

@Configuration
public class JwtConfiguration {

    private static final Pattern POSITIVE_DECIMAL_ID = Pattern.compile("[1-9][0-9]*");
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
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(pliegoJwtSecretKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtIssuerValidator("pliego"),
                new JwtTimestampValidator(Duration.ZERO),
                audienceValidator(),
                requiredClaimsValidator()));
        return decoder;
    }

    private OAuth2TokenValidator<Jwt> audienceValidator() {
        return jwt -> validAudience(jwt.getClaims().get("aud"))
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
    }

    private boolean validAudience(Object audience) {
        return "pliego-api".equals(audience)
                || audience instanceof Collection<?> values && values.equals(List.of("pliego-api"));
    }

    private OAuth2TokenValidator<Jwt> requiredClaimsValidator() {
        return jwt -> {
            String subject = jwt.getSubject();
            String role = jwt.getClaimAsString("role");
            String tokenId = jwt.getId();
            if (subject == null || !POSITIVE_DECIMAL_ID.matcher(subject).matches()
                    || role == null || !(role.equals("CUSTOMER") || role.equals("ADMIN"))
                    || tokenId == null || !isUuid(tokenId)
                    || jwt.getIssuedAt() == null || jwt.getExpiresAt() == null
                    || jwt.getIssuedAt().isAfter(Instant.now())
                    || !jwt.getExpiresAt().isAfter(jwt.getIssuedAt())
                    || jwt.getExpiresAt().getEpochSecond() - jwt.getIssuedAt().getEpochSecond() != 1800) {
                return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
            }
            try {
                Long.parseLong(subject);
            } catch (NumberFormatException ignored) {
                return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
            }
            return OAuth2TokenValidatorResult.success();
        };
    }

    private boolean isUuid(String value) {
        try {
            return java.util.UUID.fromString(value).toString().equalsIgnoreCase(value);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }
}
