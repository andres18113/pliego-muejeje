package com.pliego.foundation.security;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class PasswordPolicyTest {

    @Test
    void enforcesCodePointMinimumAndUtf8ByteMaximum() {
        assertFalse(PasswordPolicy.isValid("short", 8));
        assertTrue(PasswordPolicy.isValid("12345678", 8));
        assertTrue(PasswordPolicy.isValid("á".repeat(36), 8));
        assertFalse(PasswordPolicy.isValid("á".repeat(37), 8));
        assertFalse(PasswordPolicy.isValid("", 0));
        assertTrue(PasswordPolicy.isValid("password", 0));
    }
}
