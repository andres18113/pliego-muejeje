package com.pliego.modules.identity.application;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.foundation.security.DummyPasswordHash;
import com.pliego.foundation.security.InvalidCredentialsException;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.identity.gateway.IdentityGateway;
import com.pliego.modules.identity.gateway.RegistrationResult;
import com.pliego.modules.identity.gateway.UserAuthData;
import com.pliego.modules.identity.gateway.UserSessionData;

@Service
public class AuthService {

    private static final long ACCESS_TOKEN_TTL_SECONDS = 1800;
    private static final long SESSION_TTL_SECONDS = 30L * 24 * 60 * 60;
    private static final Pattern REFRESH_TOKEN_PATTERN = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final IdentityGateway identityGateway;
    private final AuthSessionCredentialService sessionCredentials;
    private final PasswordEncoder passwordEncoder;
    private final DummyPasswordHash dummyPasswordHash;
    private final JwtTokenIssuer jwtTokenIssuer;

    public AuthService(IdentityGateway identityGateway, PasswordEncoder passwordEncoder,
            DummyPasswordHash dummyPasswordHash, JwtTokenIssuer jwtTokenIssuer,
            AuthSessionCredentialService sessionCredentials) {
        this.identityGateway = identityGateway;
        this.sessionCredentials = sessionCredentials;
        this.passwordEncoder = passwordEncoder;
        this.dummyPasswordHash = dummyPasswordHash;
        this.jwtTokenIssuer = jwtTokenIssuer;
    }

    @Transactional
    public RegistrationResult register(String email, String password, String firstNames, String lastNames,
            String phone) {
        String passwordHash = passwordEncoder.encode(password);
        return identityGateway.register(email, passwordHash, firstNames, lastNames, phone);
    }

    @Transactional
    public LoginResult login(String email, String password) {
        UserAuthData user = identityGateway.findAuthData(email);
        boolean passwordMatches = user == null
                ? dummyPasswordHash.matches(password)
                : passwordEncoder.matches(password, user.passwordHash());

        if (!passwordMatches || user == null || !"ACTIVE".equals(user.state())
                || !("CUSTOMER".equals(user.role()) || "ADMIN".equals(user.role()))) {
            throw new InvalidCredentialsException();
        }

        Instant issuedAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant expiresAt = issuedAt.plusSeconds(ACCESS_TOKEN_TTL_SECONDS);
        Instant sessionExpiresAt = Instant.now().plusSeconds(SESSION_TTL_SECONDS);
        String refreshToken = sessionCredentials.newSessionToken();
        identityGateway.createSession(user.userId(), hashRefreshToken(refreshToken), sessionExpiresAt);
        String accessToken = jwtTokenIssuer.issue(Long.toString(user.userId()), user.role(), issuedAt, expiresAt,
                UUID.randomUUID().toString());
        return new LoginResult(accessToken, ACCESS_TOKEN_TTL_SECONDS, user.userId(), user.email(), user.role(),
                refreshToken, sessionExpiresAt);
    }

    @Transactional
    public LoginResult refresh(String refreshToken) {
        if (refreshToken == null || !REFRESH_TOKEN_PATTERN.matcher(refreshToken).matches()) {
            return null;
        }
        String replacementToken = sessionCredentials.replacementFor(refreshToken);
        UserSessionData session = identityGateway.refreshSession(hashRefreshToken(refreshToken),
                hashRefreshToken(replacementToken));
        if (session == null) {
            return null;
        }
        Instant issuedAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant expiresAt = issuedAt.plusSeconds(ACCESS_TOKEN_TTL_SECONDS);
        String accessToken = jwtTokenIssuer.issue(Long.toString(session.userId()), session.role(), issuedAt, expiresAt,
                UUID.randomUUID().toString());
        return new LoginResult(accessToken, ACCESS_TOKEN_TTL_SECONDS, session.userId(), session.email(),
                session.role(), replacementToken, session.expiresAt());
    }

    @Transactional
    public void logout(String refreshToken) {
        if (refreshToken != null && REFRESH_TOKEN_PATTERN.matcher(refreshToken).matches()) {
            identityGateway.revokeSession(hashRefreshToken(refreshToken));
        }
    }

    private String hashRefreshToken(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    public record LoginResult(String accessToken, long expiresInSeconds, long userId, String email, String role,
            String refreshToken, Instant sessionExpiresAt) {
        @Override
        public String toString() {
            return "LoginResult[accessToken=[redacted], expiresInSeconds=" + expiresInSeconds
                    + ", user=[redacted], refreshToken=[redacted], sessionExpiresAt=" + sessionExpiresAt + "]";
        }
    }
}
