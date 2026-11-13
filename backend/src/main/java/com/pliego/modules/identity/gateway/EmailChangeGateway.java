package com.pliego.modules.identity.gateway;

import com.pliego.modules.identity.application.EmailChangeResult;

/** Database API for versioned, single-use pending email changes (ADR 0049). */
public interface EmailChangeGateway {
    EmailChangeResult request(long actor, String email, String confirmHash, String confirmNonce,
            String cancelHash, String cancelNonce);
    void resend(long actor, String confirmHash, String confirmNonce);
    void cancelForUser(long actor);
    String findNonce(String type, String hash);
    String confirm(String hash);
    void cancelWithToken(String hash);
}
