package com.pliego.modules.identity.application;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import com.pliego.modules.identity.gateway.IdentityGateway;

@ExtendWith(MockitoExtension.class)
class EmailActionReturnContextTest {
    @Mock IdentityGateway gateway;
    @Mock PasswordEncoder passwords;
    EmailActionService service;

    @BeforeEach void setup() {
        service = new EmailActionService(gateway, new EmailActionTokens("local-fixture-token-secret-32-bytes-long"), passwords);
    }

    @Test void newlyEnqueuedResendKeepsItsOwnNonceAndAllowedContext() {
        when(gateway.requestEmailAction(anyString(), anyString(), anyString(), anyString(), anyString())).thenReturn(true);
        service.request("new@example.invalid", "VERIFY_EMAIL", "127.0.0.1", "/cart?source=edition#items");
        var nonce = ArgumentCaptor.forClass(String.class);
        verify(gateway).requestEmailAction(eq("new@example.invalid"), eq("VERIFY_EMAIL"), anyString(), nonce.capture(), anyString());
        verify(gateway).setEmailActionReturnPath(nonce.getValue(), "/cart?source=edition#items");
    }

    @Test void NeutralLimitedOrUnknownRequestNeverMutatesAnExistingMail() {
        when(gateway.requestEmailAction(anyString(), anyString(), anyString(), anyString(), anyString())).thenReturn(false);
        service.request("unknown@example.invalid", "VERIFY_EMAIL", "127.0.0.1", "/cart");
        verify(gateway, never()).setEmailActionReturnPath(anyString(), anyString());
    }

    @Test void recoveryIgnoresAnExternalDestinationWithoutChangingIssuance() {
        when(gateway.requestEmailAction(anyString(), anyString(), anyString(), anyString(), anyString())).thenReturn(true);
        service.request("new@example.invalid", "RESET_PASSWORD", "127.0.0.1", "https://evil.test/cart");
        verify(gateway).requestEmailAction(eq("new@example.invalid"), eq("RESET_PASSWORD"), anyString(), anyString(), anyString());
        verify(gateway, never()).setEmailActionReturnPath(anyString(), anyString());
    }
}
