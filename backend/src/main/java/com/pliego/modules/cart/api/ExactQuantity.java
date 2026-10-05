package com.pliego.modules.cart.api;

import static java.lang.annotation.ElementType.ANNOTATION_TYPE;
import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.RECORD_COMPONENT;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/** Validates quantity representation without changing the database's positivity rule. */
@Documented
@Constraint(validatedBy = ExactQuantityValidator.class)
@Target({ FIELD, PARAMETER, RECORD_COMPONENT, ANNOTATION_TYPE })
@Retention(RUNTIME)
public @interface ExactQuantity {
    String message() default "Escribe una cantidad entera de hasta 2147483647, sin decimales.";
    Class<?>[] groups() default { };
    Class<? extends Payload>[] payload() default { };
}
