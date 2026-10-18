package com.pliego.foundation.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class EcuadorianCedulaValidator implements ConstraintValidator<ValidEcuadorianCedula, String> {
    @Override public boolean isValid(String value, ConstraintValidatorContext context) {
        return EcuadorianCedula.isValid(value);
    }
}
