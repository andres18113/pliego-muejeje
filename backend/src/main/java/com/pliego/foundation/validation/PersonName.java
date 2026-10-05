package com.pliego.foundation.validation;

import java.lang.annotation.*;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

@Target({ElementType.FIELD,ElementType.PARAMETER,ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy=PersonNameValidator.class)
public @interface PersonName {
    String label();
    String message() default "Revisa el nombre o apellido.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
