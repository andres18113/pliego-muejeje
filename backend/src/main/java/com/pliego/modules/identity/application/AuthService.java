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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.pliego.foundation.security.DummyPasswordHash;
import com.pliego.foundation.security.InvalidCredentialsException;
import com.pliego.foundation.security.EmailNotVerifiedException;
import com.pliego.foundation.security.LoginAttemptLimitedException;
import com.pliego.modules.identity.gateway.LoginAttemptGateway;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.foundation.security.JwtAccessTokenClaims;
import com.pliego.modules.identity.gateway.IdentityGateway;
import com.pliego.modules.identity.gateway.RegistrationResult;
import com.pliego.modules.identity.gateway.UserAuthData;
import com.pliego.modules.identity.gateway.UserSessionData;

@Service
public class AuthService {
    private static final Logger LOG = LoggerFactory.getLogger(AuthService.class);

    private static final long ACCESS_TOKEN_TTL_SECONDS = JwtAccessTokenClaims.LIFETIME.toSeconds();
    private static final long SESSION_TTL_SECONDS = 30L * 24 * 60 * 60;
    private static final Pattern REFRESH_TOKEN_PATTERN = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final IdentityGateway identityGateway;
    private final AuthSessionCredentialService sessionCredentials;
    private final PasswordEncoder passwordEncoder;
    private final DummyPasswordHash dummyPasswordHash;
    private final JwtTokenIssuer jwtTokenIssuer;
    private final EmailActionTokens emailTokens;
    private final LoginAttemptGateway loginAttempts;
    private final LoginAttemptAdmissionService loginAdmission;

    public AuthService(IdentityGateway identityGateway, PasswordEncoder passwordEncoder,
            DummyPasswordHash dummyPasswordHash, JwtTokenIssuer jwtTokenIssuer,
            AuthSessionCredentialService sessionCredentials, EmailActionTokens emailTokens,
            LoginAttemptGateway loginAttempts, LoginAttemptAdmissionService loginAdmission) {
        this.identityGateway = identityGateway;
        this.sessionCredentials = sessionCredentials;
        this.passwordEncoder = passwordEncoder;
        this.dummyPasswordHash = dummyPasswordHash;
        this.jwtTokenIssuer = jwtTokenIssuer;
        this.emailTokens = emailTokens;
        this.loginAttempts = loginAttempts;
        this.loginAdmission = loginAdmission;
    }

    @Transactional
    public RegistrationResult register(String email, String password, String firstNames, String lastNames,
            String phone, String returnTo) {
        String passwordHash = passwordEncoder.encode(password);
        var credential = emailTokens.issue("VERIFY_EMAIL");
        RegistrationResult result = identityGateway.register(email, passwordHash, firstNames, lastNames, phone, credential.hash(), credential.nonce());
        String safePath = AuthReturnPaths.safeOrNull(returnTo);
        if (result.userId() > 0 && safePath != null) identityGateway.setEmailActionReturnPath(credential.nonce(), safePath);
        return result;
    }

    @Transactional(noRollbackFor = {InvalidCredentialsException.class, EmailNotVerifiedException.class,
            LoginAttemptLimitedException.class})
    public LoginResult login(String email, String password, String remoteAddress) {
        String ipHash = EmailActionTokens.hash(remoteAddress);
        var pairBlockedUntil = loginAttempts.beginPair(email, ipHash);
        int retryAfter = loginAdmission.admit(email, ipHash, pairBlockedUntil);
        if (retryAfter > 0) {
            LOG.warn("login_attempt state=LIMITED code=AUTH_LOGIN_RATE_LIMITED retry_after_seconds={} trace_id={}",
                    retryAfter, org.slf4j.MDC.get("traceId"));
            throw new LoginAttemptLimitedException(retryAfter);
        }
        loginAttempts.reservePairFailure(email, ipHash);
        UserAuthData user = identityGateway.findAuthData(email);
        boolean passwordMatches = user == null
                ? dummyPasswordHash.matches(password)
                : passwordEncoder.matches(password, user.passwordHash());

        if (passwordMatches && user != null && "UNVERIFIED".equals(user.state())) {
            throw new EmailNotVerifiedException();
        }
        if (!passwordMatches || user == null || !"ACTIVE".equals(user.state())
                || user.role() == null || !JwtAccessTokenClaims.ROLES.contains(user.role())) {
            throw new InvalidCredentialsException();
        }

        Instant issuedAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant expiresAt = issuedAt.plus(JwtAccessTokenClaims.LIFETIME);
        Instant sessionExpiresAt = Instant.now().plusSeconds(SESSION_TTL_SECONDS);
        String refreshToken = sessionCredentials.newSessionToken();
        if (!identityGateway.createSession(user.userId(), hashRefreshToken(refreshToken), sessionExpiresAt,
                user.passwordHash(), user.email())) {
            throw new InvalidCredentialsException();
        }
        String accessToken = jwtTokenIssuer.issue(Long.toString(user.userId()), user.role(), issuedAt, expiresAt,
                UUID.randomUUID().toString());
        loginAttempts.success(email, ipHash);
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
        Instant expiresAt = issuedAt.plus(JwtAccessTokenClaims.LIFETIME);
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
