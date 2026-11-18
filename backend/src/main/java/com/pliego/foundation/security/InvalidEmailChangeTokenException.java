package com.pliego.foundation.security;

/** Safe public failure; never retains an action credential. */
public final class InvalidEmailChangeTokenException extends RuntimeException {
    public InvalidEmailChangeTokenException() {
        super("El enlace de cambio de correo no es válido.");
    }
}
