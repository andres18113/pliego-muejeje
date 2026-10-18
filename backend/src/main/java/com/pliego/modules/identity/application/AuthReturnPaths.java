package com.pliego.modules.identity.application;

import java.net.URI;
import java.util.regex.Pattern;

/** Navigation context only: it never grants access or changes the verification policy. */
public final class AuthReturnPaths {
    private static final Pattern PATH = Pattern.compile(
            "/(?:catalog(?:/editions/[1-9][0-9]{0,18})?|ofertas|favorites|cart|checkout|account(?:/addresses)?|(?:orders|biblioteca)(?:/[1-9][0-9]{0,18})?)?/?");

    private AuthReturnPaths() {}

    public static String safeOrNull(String candidate) {
        if (candidate == null || candidate.length() > 2048 || !candidate.startsWith("/")
                || candidate.startsWith("//") || candidate.indexOf('\\') >= 0
                || candidate.chars().anyMatch(c -> c < 32 || c == 127)) return null;
        try {
            URI uri = URI.create(candidate);
            return uri.getRawAuthority() == null && PATH.matcher(uri.getRawPath()).matches() ? candidate : null;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }
}
