package com.pliego.foundation.security;

import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/** One random BCrypt value for equalizing unknown-user and known-user password checks. */
@Component
public final class DummyPasswordHash {

    private final String value;
    private final PasswordEncoder passwordEncoder;

    public DummyPasswordHash(PasswordEncoder passwordEncoder) {
        this.passwordEncoder = passwordEncoder;
        this.value = passwordEncoder.encode(UUID.randomUUID() + UUID.randomUUID().toString());
    }

    public boolean matches(String rawPassword) {
        return passwordEncoder.matches(rawPassword, value);
    }

    @Override
    public String toString() {
        return "DummyPasswordHash[redacted]";
    }
}
