package com.pliego.modules.cart.api;

import java.math.BigDecimal;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class ExactQuantityValidator implements ConstraintValidator<ExactQuantity, BigDecimal> {
    @Override
    public boolean isValid(BigDecimal value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        try {
            value.intValueExact();
            return true;
        } catch (ArithmeticException exception) {
            return false;
        }
    }
}
