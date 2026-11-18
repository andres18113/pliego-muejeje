package com.pliego.modules.identity.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import com.pliego.modules.identity.gateway.EmailChangeGateway;
import com.pliego.foundation.security.InvalidEmailChangeTokenException;

class EmailChangeServiceTest {
    private final EmailChangeGateway gateway = mock(EmailChangeGateway.class);
    private final EmailActionTokens tokens = new EmailActionTokens("local-email-change-test-secret-32-bytes");
    private final EmailChangeService service = new EmailChangeService(gateway, tokens);

    @Test
    void requestPersistsSeparateCredentialsWithoutPromotingTheLoginAddress() {
        var result = new EmailChangeResult("actual@example.com", "nueva@example.com", Instant.now().plusSeconds(86400));
        when(gateway.request(eq(7L), eq("Nueva@Example.com"), anyString(), anyString(), anyString(), anyString()))
            .thenAnswer(call -> {
                String confirmHash = call.getArgument(2), confirmNonce = call.getArgument(3);
                String cancelHash = call.getArgument(4), cancelNonce = call.getArgument(5);
                assertEquals(confirmHash, EmailActionTokens.hash(tokens.derive("EMAIL_CHANGE_CONFIRM", confirmNonce)));
                assertEquals(cancelHash, EmailActionTokens.hash(tokens.derive("EMAIL_CHANGE_CANCEL", cancelNonce)));
                assertNotEquals(confirmHash, cancelHash);
                return result;
            });
        assertEquals(result, service.request(7, "Nueva@Example.com"));
        verify(gateway, never()).confirm(anyString());
    }

    @Test
    void confirmationVerifiesDerivedCredentialBeforePassingOnlyTheHashToDatabase() {
        var credential = tokens.issue("EMAIL_CHANGE_CONFIRM");
        String token = tokens.derive("EMAIL_CHANGE_CONFIRM", credential.nonce());
        when(gateway.findNonce("EMAIL_CHANGE_CONFIRM", credential.hash())).thenReturn(credential.nonce());
        when(gateway.confirm(credential.hash())).thenReturn("nueva@example.com");
        assertEquals("nueva@example.com", service.confirm(token));
        verify(gateway).confirm(credential.hash());
        verify(gateway, never()).confirm(token);
    }

    @Test
    void aStoredNonceCannotAuthorizeAForgedOrWrongPurposeCredential() {
        var credential = tokens.issue("EMAIL_CHANGE_CANCEL");
        String cancelToken = tokens.derive("EMAIL_CHANGE_CANCEL", credential.nonce());
        when(gateway.findNonce("EMAIL_CHANGE_CONFIRM", credential.hash())).thenReturn(credential.nonce());
        assertThrows(InvalidEmailChangeTokenException.class, () -> service.confirm(cancelToken));
        verify(gateway, never()).confirm(anyString());
    }

    @Test
    void aHashLookupWithTheWrongStoredNonceStillCannotAuthorizeConfirmation() {
        var presented = tokens.issue("EMAIL_CHANGE_CONFIRM");
        var unrelated = tokens.issue("EMAIL_CHANGE_CONFIRM");
        String token = tokens.derive("EMAIL_CHANGE_CONFIRM", presented.nonce());
        when(gateway.findNonce("EMAIL_CHANGE_CONFIRM", presented.hash())).thenReturn(unrelated.nonce());
        assertThrows(InvalidEmailChangeTokenException.class, () -> service.confirm(token));
        verify(gateway, never()).confirm(anyString());
    }

    @Test
    void invalidOrUnknownTokensHaveTheSameSafeFailureWithoutMutatingState() {
        for (String token : new String[]{null, "", "invalido", "x".repeat(44), "ñ".repeat(43), "A".repeat(43)}) {
            assertThrows(InvalidEmailChangeTokenException.class, () -> service.confirm(token));
        }
        verify(gateway, never()).confirm(anyString());
    }

    @Test
    void cancellationUsesItsOwnPurposeAndNeverConfirms() {
        var credential = tokens.issue("EMAIL_CHANGE_CANCEL");
        String token = tokens.derive("EMAIL_CHANGE_CANCEL", credential.nonce());
        when(gateway.findNonce("EMAIL_CHANGE_CANCEL", credential.hash())).thenReturn(credential.nonce());
        service.cancelWithToken(token);
        verify(gateway).cancelWithToken(credential.hash());
        verify(gateway, never()).confirm(anyString());
    }

    @Test
    void resendIssuesASeparateConfirmationCredentialForTheSamePendingRequest() {
        doAnswer(call -> {
            assertEquals(call.getArgument(1), EmailActionTokens.hash(tokens.derive("EMAIL_CHANGE_CONFIRM", call.getArgument(2))));
            return null;
        }).when(gateway).resend(eq(7L), anyString(), anyString());
        service.resend(7);
        verify(gateway).resend(eq(7L), anyString(), anyString());
    }
}
