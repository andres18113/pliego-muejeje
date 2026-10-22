package com.pliego.foundation.validation;

import java.lang.annotation.*;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

/** Validates a type/number pair together and reports the problem on {@code number}. */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ValidEcuadorianIdentification.Validator.class)
public @interface ValidEcuadorianIdentification {
    String message() default EcuadorianIdentification.MESSAGE;
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};

    /** A request carrying one Ecuadorian identification. */
    interface Value {
        String type();
        String number();
    }

    final class Validator implements ConstraintValidator<ValidEcuadorianIdentification, Value> {
        @Override public boolean isValid(Value value, ConstraintValidatorContext context) {
            if (value == null || value.type() == null || EcuadorianIdentification.isValid(value.type(), value.number())) return true;
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(context.getDefaultConstraintMessageTemplate())
                    .addPropertyNode("number").addConstraintViolation();
            return false;
        }
    }
}
