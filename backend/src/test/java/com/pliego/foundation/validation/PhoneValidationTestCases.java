package com.pliego.foundation.validation;

import java.util.stream.Stream;

import org.junit.jupiter.params.provider.Arguments;

public final class PhoneValidationTestCases {
    private static final String PHONE_CHARACTERS = "Escribe solo dígitos en el número de teléfono.";

    private PhoneValidationTestCases() { }

    public static Stream<Arguments> malformedPhones() {
        return Stream.of(
                Arguments.of("abc", PHONE_CHARACTERS),
                Arguments.of("+593abc", PHONE_CHARACTERS),
                Arguments.of("+5930991234567", "Escribe el número sin el 0 inicial; el prefijo +593 ya está incluido."),
                Arguments.of("+442079460018", "Solo se aceptan teléfonos de Ecuador (+593)."),
                Arguments.of("+59399123456789", "El número no puede tener más de 9 dígitos."),
                Arguments.of("+59399", "Un celular de Ecuador debe tener 9 dígitos y empezar con 9."),
                Arguments.of(" \t\n", PHONE_CHARACTERS),
                Arguments.of("+593９９１２３４５６７", PHONE_CHARACTERS),
                Arguments.of("+593991234567 ext 2", PHONE_CHARACTERS));
    }
}
