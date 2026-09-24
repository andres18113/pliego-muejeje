package com.pliego.modules.sales.application;

/** Fixed public feedback; never stores or formats the submitted card number. */
public final class InvalidCardNumberException extends RuntimeException {
    public InvalidCardNumberException() {
        super("El número de tarjeta no es válido.");
    }
}
