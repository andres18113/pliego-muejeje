package com.pliego.foundation.security;

import java.io.IOException;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/** Requires the browser-client marker on cookie-authenticated session mutations. */
@Component
public final class AuthSessionRequestFilter extends OncePerRequestFilter {

    public static final String HEADER_NAME = "X-PLIEGO-SESSION-REQUEST";
    private static final String HEADER_VALUE = "1";

    private final SecurityProblemWriter problemWriter;

    public AuthSessionRequestFilter(SecurityProblemWriter problemWriter) {
        this.problemWriter = problemWriter;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!"POST".equalsIgnoreCase(request.getMethod())) return true;
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return !"/api/v1/auth/refresh".equals(path) && !"/api/v1/auth/logout".equals(path);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (!HEADER_VALUE.equals(request.getHeader(HEADER_NAME))) {
            problemWriter.write(request, response, "ACCESS_DENIED", "Acceso denegado", HttpStatus.FORBIDDEN,
                    "No tienes permiso para realizar esta operación.");
            return;
        }
        filterChain.doFilter(request, response);
    }
}
