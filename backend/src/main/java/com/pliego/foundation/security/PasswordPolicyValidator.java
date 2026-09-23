package com.pliego.foundation.security;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class PasswordPolicyValidator implements ConstraintValidator<ValidPassword, String> {

    private int minimumCodePoints;

    @Override
    public void initialize(ValidPassword constraintAnnotation) {
        minimumCodePoints = constraintAnnotation.minimumCodePoints();
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || PasswordPolicy.isValid(value, minimumCodePoints);
    }
}
