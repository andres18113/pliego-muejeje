package com.pliego.modules.identity.gateway;

import java.time.Instant;

public interface IdentityGateway {

    RegistrationResult register(String email, String passwordHash, String firstNames, String lastNames, String phone,
            String verificationHash, String verificationNonce);

    boolean requestEmailAction(String email, String purpose, String tokenHash, String nonce, String requestHash);

    boolean consumeEmailAction(String purpose, String tokenHash, String passwordHash);

    void enqueueEmailVerification(long userId, String tokenHash, String nonce);

    UserAuthData findAuthData(String email);

    boolean createSession(long userId, String refreshTokenHash, Instant expiresAt, String expectedPasswordHash);

    UserSessionData refreshSession(String currentRefreshTokenHash, String replacementRefreshTokenHash);

    void revokeSession(String refreshTokenHash);
}
