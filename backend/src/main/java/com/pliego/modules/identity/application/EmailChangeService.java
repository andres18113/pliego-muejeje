package com.pliego.modules.identity.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.foundation.security.InvalidEmailChangeTokenException;
import com.pliego.modules.identity.gateway.EmailChangeGateway;

@Service
public class EmailChangeService {
    private static final String CONFIRM = "EMAIL_CHANGE_CONFIRM";
    private static final String CANCEL = "EMAIL_CHANGE_CANCEL";
    private final EmailChangeGateway gateway;
    private final EmailActionTokens tokens;

    public EmailChangeService(EmailChangeGateway gateway, EmailActionTokens tokens) {
        this.gateway = gateway;
        this.tokens = tokens;
    }

    /** Joins the transaction holding the user's password reauthentication lock. */
    @Transactional
    public EmailChangeResult request(long actor, String email) {
        var confirm = tokens.issue(CONFIRM);
        var cancel = tokens.issue(CANCEL);
        return gateway.request(actor, email, confirm.hash(), confirm.nonce(), cancel.hash(), cancel.nonce());
    }

    @Transactional
    public void resend(long actor) {
        var confirm = tokens.issue(CONFIRM);
        gateway.resend(actor, confirm.hash(), confirm.nonce());
    }

    @Transactional
    public void cancelForUser(long actor) {
        gateway.cancelForUser(actor);
    }

    @Transactional
    public String confirm(String token) {
        return gateway.confirm(verifiedHash(CONFIRM, token));
    }

    @Transactional
    public void cancelWithToken(String token) {
        gateway.cancelWithToken(verifiedHash(CANCEL, token));
    }

    private String verifiedHash(String type, String token) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) {
            throw new InvalidEmailChangeTokenException();
        }
        String hash = EmailActionTokens.hash(token);
        String nonce = gateway.findNonce(type, hash);
        if (nonce == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.US_ASCII),
                tokens.derive(type, nonce).getBytes(StandardCharsets.US_ASCII))) {
            throw new InvalidEmailChangeTokenException();
        }
        return hash;
    }
}
