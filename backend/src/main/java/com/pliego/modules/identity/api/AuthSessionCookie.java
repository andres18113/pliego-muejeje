package com.pliego.modules.identity.api;

import java.time.Duration;
import java.time.Instant;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/** Secure, host-only cookie carrying the opaque, revocable refresh credential. */
@Component
public final class AuthSessionCookie {

    public static final String NAME = "pliego_session";
    private static final String PATH = "/api/v1/auth";

    private final boolean secure;

    public AuthSessionCookie(@Value("${pliego.auth.cookie-secure:true}") boolean secure) {
        this.secure = secure;
    }

    public String issue(String token, Instant expiresAt) {
        long maxAge = Math.max(0, Duration.between(Instant.now(), expiresAt).getSeconds());
        return ResponseCookie.from(NAME, token)
                .httpOnly(true)
                .secure(secure)
                .sameSite("Strict")
                .path(PATH)
                .maxAge(Duration.ofSeconds(maxAge))
                .build()
                .toString();
    }

    public String clear() {
        return ResponseCookie.from(NAME, "")
                .httpOnly(true)
                .secure(secure)
                .sameSite("Strict")
                .path(PATH)
                .maxAge(Duration.ZERO)
                .build()
                .toString();
    }
}
