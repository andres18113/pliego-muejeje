package com.pliego.foundation.security;

/** Deliberately does not distinguish an unknown, blocked, or incorrectly authenticated user. */
public final class InvalidCredentialsException extends RuntimeException {

    public InvalidCredentialsException() {
        super("AUTH_INVALID_CREDENTIALS");
    }
}
