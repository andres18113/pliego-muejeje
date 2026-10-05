package com.pliego.foundation.validation;

import java.lang.annotation.*;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

@Target({ElementType.FIELD,ElementType.PARAMETER,ElementType.RECORD_COMPONENT}) @Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy=AddressRecipientValidator.class)
public @interface AddressRecipient {
    String message() default "Revisa el destinatario del pedido.";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
