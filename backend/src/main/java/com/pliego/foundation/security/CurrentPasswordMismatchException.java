package com.pliego.foundation.security;

/**
 * The current password supplied to confirm an identity change is wrong. The session itself is valid,
 * so this is a 400 problem rather than a 401: clients must not treat it as an expired session.
 */
public final class CurrentPasswordMismatchException extends RuntimeException {

    public CurrentPasswordMismatchException() {
        super("CURRENT_PASSWORD_INVALID");
    }
}
