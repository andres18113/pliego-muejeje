package com.pliego.foundation.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class AddressRecipientValidator implements ConstraintValidator<AddressRecipient,String> {
    @Override public boolean isValid(String value,ConstraintValidatorContext context) {
        String error=PersonRules.recipientError(value);
        if(error==null) return true;
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(error).addConstraintViolation();
        return false;
    }
}
