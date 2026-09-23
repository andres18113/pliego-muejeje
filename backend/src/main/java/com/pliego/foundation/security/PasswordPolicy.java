package com.pliego.foundation.security;

import java.nio.charset.StandardCharsets;

public final class PasswordPolicy {

    public static final int MAX_UTF8_BYTES = 72;

    private PasswordPolicy() {
    }

    public static boolean isValid(String password, int minimumCodePoints) {
        return password != null && !password.isEmpty()
                && password.codePointCount(0, password.length()) >= minimumCodePoints
                && password.getBytes(StandardCharsets.UTF_8).length <= MAX_UTF8_BYTES;
    }
}
