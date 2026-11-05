package com.pliego.modules.identity.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.nio.charset.StandardCharsets;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import com.pliego.foundation.security.DummyPasswordHash;
import com.pliego.foundation.security.InvalidCredentialsException;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.identity.gateway.*;

class AuthIdentityConsistencyTest {
    private final SnapshotGateway gateway = new SnapshotGateway();
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final SecretKeySpec key = new SecretKeySpec("local-identity-race-secret-32bytes".getBytes(StandardCharsets.US_ASCII), "HmacSHA256");
    private final AuthService service = new AuthService(gateway, passwords, mock(DummyPasswordHash.class),
            new JwtTokenIssuer(key), new AuthSessionCredentialService(key),
            new EmailActionTokens("local-email-action-secret-32-bytes"), mock(LoginAttemptGateway.class),
            mock(LoginAttemptAdmissionService.class));

    @Test
    void promotionAfterPasswordSnapshotCannotCreateARefreshSessionUsingTheOldAddress() {
        when(passwords.matches(anyString(), anyString())).thenAnswer(call -> {
            gateway.currentEmail = "new@example.com"; // Confirmation committed after fn_user_auth_data's snapshot.
            return true;
        });
        assertThrows(InvalidCredentialsException.class, () -> service.login("old@example.com", "correct-password", "127.0.0.1"));
        assertEquals(0, gateway.createdSessions);
        assertEquals("old@example.com", gateway.expectedEmail);
    }

    @Test
    void sessionCreationBindsTheCanonicalEmailReadForPasswordAuthentication() {
        when(passwords.matches(anyString(), anyString())).thenReturn(true);
        var result = service.login("OLD@Example.com", "correct-password", "127.0.0.1");
        assertEquals("old@example.com", result.email());
        assertEquals("old@example.com", gateway.expectedEmail);
        assertEquals(1, gateway.createdSessions);
    }

    private static final class SnapshotGateway implements IdentityGateway {
        private String currentEmail = "old@example.com";
        private String expectedEmail;
        private int createdSessions;

        @Override public UserAuthData findAuthData(String email) {
            return new UserAuthData(7, "old@example.com", "unchanged-password-hash", "CUSTOMER", "ACTIVE");
        }
        @Override public boolean createSession(long user, String refresh, Instant expires, String passwordHash) {
            createdSessions++;
            return true;
        }
        @Override public boolean createSession(long user, String refresh, Instant expires, String passwordHash, String email) {
            expectedEmail = email;
            if (!currentEmail.equals(email)) return false;
            createdSessions++;
            return true;
        }
        @Override public RegistrationResult register(String email, String passwordHash, String firstNames, String lastNames,
                String phone, String hash, String nonce) { throw new UnsupportedOperationException(); }
        @Override public boolean requestEmailAction(String email, String purpose, String hash, String nonce, String remote) { return false; }
        @Override public void setEmailActionReturnPath(String nonce, String path) {}
        @Override public boolean consumeEmailAction(String purpose, String hash, String passwordHash) { return false; }
        @Override public void enqueueEmailVerification(long user, String hash, String nonce) {}
        @Override public UserSessionData refreshSession(String current, String replacement) { return null; }
        @Override public void revokeSession(String refresh) {}
    }
}
