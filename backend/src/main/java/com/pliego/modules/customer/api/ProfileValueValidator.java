package com.pliego.modules.customer.api;

import com.pliego.foundation.validation.PersonRules;
import com.pliego.foundation.validation.PhoneNumbers;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class ProfileValueValidator implements ConstraintValidator<ValidProfileValue,ProfilePatchRequest> {
    @Override public boolean isValid(ProfilePatchRequest request,ConstraintValidatorContext context) {
        if(request==null || request.field()==null) return true;
        String error=switch(request.field()) {
            case "firstNames" -> PersonRules.nameError(request.value(),"nombres");
            case "lastNames" -> PersonRules.nameError(request.value(),"apellidos");
            case "phone" -> PhoneNumbers.error(request.value(),false);
            default -> null;
        };
        if(error==null) return true;
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(error).addPropertyNode("value").addConstraintViolation();
        return false;
    }
}
