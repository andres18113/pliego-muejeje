package com.pliego.foundation.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.pliego.modules.identity.api.LoginRequest;
import com.pliego.modules.identity.api.LoginResponse;
import com.pliego.modules.identity.api.RegisterRequest;
import com.pliego.modules.identity.application.AuthService;
import com.pliego.modules.identity.gateway.UserAuthData;

class SensitiveDataToStringTest {

    @Test
    void authenticationDiagnosticsRedactCredentialsAndPersonalData() {
        String email = "private@example.invalid";
        String password = "test-password-secret";
        String token = "jwt-test-only-token";
        String hash = "$2a$12$test-only-password-hash";
        String userId = "987654";

        String[] diagnostics = {
                new RegisterRequest(email, password, "Private Name", "Private Surname", "+59325550134")
                        .toString(),
                new LoginRequest(email, password).toString(),
                new AuthService.LoginResult(token, 1800, Long.parseLong(userId), email, "CUSTOMER").toString(),
                new LoginResponse(token, "Bearer", 1800,
                        new LoginResponse.AuthenticatedUser(userId, email, "CUSTOMER")).toString(),
                new LoginResponse.AuthenticatedUser(userId, email, "CUSTOMER").toString(),
                new UserAuthData(Long.parseLong(userId), email, hash, "CUSTOMER", "ACTIVE").toString()
        };
        String[] sensitiveValues = {
                email, password, token, hash, userId, "Private Name", "Private Surname", "+59325550134"
        };

        for (String diagnostic : diagnostics) {
            assertThat(diagnostic).contains("[redacted]");
            assertThat(diagnostic).doesNotContain(sensitiveValues);
        }
    }
}
