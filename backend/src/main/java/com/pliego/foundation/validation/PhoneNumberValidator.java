package com.pliego.foundation.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class PhoneNumberValidator implements ConstraintValidator<PhoneNumber,String> {
    private boolean required;
    @Override public void initialize(PhoneNumber annotation) { required=annotation.required(); }
    @Override public boolean isValid(String value,ConstraintValidatorContext context) {
        String error=PhoneNumbers.error(value,required);
        if(error==null) return true;
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(error).addConstraintViolation();
        return false;
    }
}
