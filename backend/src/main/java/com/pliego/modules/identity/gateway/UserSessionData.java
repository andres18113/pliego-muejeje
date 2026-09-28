package com.pliego.modules.identity.gateway;

import java.time.Instant;

/** Identity returned by PostgreSQL when a persistent authentication session is refreshed. */
public record UserSessionData(long userId, String email, String role, Instant expiresAt) {

    @Override
    public String toString() {
        return "UserSessionData[identity=[redacted], expiresAt=" + expiresAt + "]";
    }
}
