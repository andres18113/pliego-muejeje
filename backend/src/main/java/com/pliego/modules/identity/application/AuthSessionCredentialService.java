package com.pliego.modules.identity.application;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.Mac;
import javax.crypto.SecretKey;

import org.springframework.stereotype.Component;

/** Creates opaque refresh credentials and derives idempotent rotations with key-purpose separation. */
@Component
public final class AuthSessionCredentialService {

    private static final byte[] ROTATION_PURPOSE = "PLIEGO:auth-session-refresh:v1:".getBytes(StandardCharsets.US_ASCII);
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final SecretKey key;

    public AuthSessionCredentialService(SecretKey pliegoJwtSecretKey) {
        this.key = pliegoJwtSecretKey;
    }

    public String newSessionToken() {
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Repeating refresh with the same old credential derives the same replacement after a lost response. */
    public String replacementFor(String currentToken) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            mac.update(ROTATION_PURPOSE);
            byte[] replacement = mac.doFinal(currentToken.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(replacement);
        } catch (java.security.GeneralSecurityException exception) {
            throw new IllegalStateException("Unable to rotate the authentication session", exception);
        }
    }
}
