package com.pliego.foundation.validation;

import java.lang.annotation.*;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

@Target({ElementType.FIELD,ElementType.PARAMETER,ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy=PhoneNumberValidator.class)
public @interface PhoneNumber {
    boolean required() default false;
    String message() default "Revisa el prefijo internacional y el teléfono.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
