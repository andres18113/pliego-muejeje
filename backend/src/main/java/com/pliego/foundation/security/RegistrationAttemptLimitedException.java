package com.pliego.foundation.security;

public final class RegistrationAttemptLimitedException extends RuntimeException {
    private final int retryAfterSeconds;

    public RegistrationAttemptLimitedException(int retryAfterSeconds) {
        super("Demasiados intentos");
        this.retryAfterSeconds = Math.clamp(retryAfterSeconds, 1, 3600);
    }

    public int retryAfterSeconds() { return retryAfterSeconds; }
}
