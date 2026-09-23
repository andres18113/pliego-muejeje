package com.pliego.modules.identity.application;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.foundation.security.DummyPasswordHash;
import com.pliego.foundation.security.InvalidCredentialsException;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.identity.gateway.IdentityGateway;
import com.pliego.modules.identity.gateway.RegistrationResult;
import com.pliego.modules.identity.gateway.UserAuthData;

@Service
public class AuthService {

    private static final long ACCESS_TOKEN_TTL_SECONDS = 1800;

    private final IdentityGateway identityGateway;
    private final PasswordEncoder passwordEncoder;
    private final DummyPasswordHash dummyPasswordHash;
    private final JwtTokenIssuer jwtTokenIssuer;

    public AuthService(IdentityGateway identityGateway, PasswordEncoder passwordEncoder,
            DummyPasswordHash dummyPasswordHash, JwtTokenIssuer jwtTokenIssuer) {
        this.identityGateway = identityGateway;
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

    @Transactional(readOnly = true)
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
        String accessToken = jwtTokenIssuer.issue(Long.toString(user.userId()), user.role(), issuedAt, expiresAt,
                UUID.randomUUID().toString());
        return new LoginResult(accessToken, ACCESS_TOKEN_TTL_SECONDS, user.userId(), user.email(), user.role());
    }

    public record LoginResult(String accessToken, long expiresInSeconds, long userId, String email, String role) {
        @Override
        public String toString() {
            return "LoginResult[accessToken=[redacted], expiresInSeconds=" + expiresInSeconds + ", userId=" + userId
                    + ", email=" + email + ", role=" + role + "]";
        }
    }
}
