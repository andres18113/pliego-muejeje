package com.pliego.foundation.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class PersonNameValidator implements ConstraintValidator<PersonName,String> {
    private String label;
    @Override public void initialize(PersonName annotation) { label=annotation.label(); }
    @Override public boolean isValid(String value,ConstraintValidatorContext context) {
        String error=PersonRules.nameError(value,label);
        if(error==null) return true;
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(error).addConstraintViolation();
        return false;
    }
}
