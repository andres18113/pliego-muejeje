package com.pliego.foundation.security;

import java.time.Duration;
import java.util.Set;

/** Values that issuance and validation must agree on for the access-token contract. */
public final class JwtAccessTokenClaims {
    public static final String ISSUER = "pliego";
    public static final String AUDIENCE = "pliego-api";
    public static final Duration LIFETIME = Duration.ofSeconds(1800);
    public static final Set<String> ROLES = Set.of("CUSTOMER", "ADMIN");

    private JwtAccessTokenClaims() {}
}
