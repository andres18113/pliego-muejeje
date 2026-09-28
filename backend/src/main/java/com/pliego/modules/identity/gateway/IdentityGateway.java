package com.pliego.modules.identity.gateway;

import java.time.Instant;

public interface IdentityGateway {

    RegistrationResult register(String email, String passwordHash, String firstNames, String lastNames, String phone);

    UserAuthData findAuthData(String email);

    void createSession(long userId, String refreshTokenHash, Instant expiresAt);

    UserSessionData refreshSession(String currentRefreshTokenHash, String replacementRefreshTokenHash);

    void revokeSession(String refreshTokenHash);
}
