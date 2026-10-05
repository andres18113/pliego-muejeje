package com.pliego.modules.customer.api;

import java.lang.annotation.*;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

@Target(ElementType.TYPE) @Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy=ProfileValueValidator.class)
public @interface ValidProfileValue {
    String message() default "Revisa el dato del perfil.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
