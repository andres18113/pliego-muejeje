package com.pliego.foundation.security;

public final class LoginAttemptLimitedException extends RuntimeException {
    private final int retryAfterSeconds;

    public LoginAttemptLimitedException(int retryAfterSeconds) {
        super("Demasiados intentos");
        this.retryAfterSeconds = Math.clamp(retryAfterSeconds, 1, 3600);
    }

    public int retryAfterSeconds() { return retryAfterSeconds; }
}
