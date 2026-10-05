package com.pliego.foundation.validation;

import java.util.regex.Pattern;
import com.google.i18n.phonenumbers.PhoneNumberUtil;
import com.google.i18n.phonenumbers.NumberParseException;

/** Metadata version matches libphonenumber-js 1.13.14. Never infer country or discard digits. */
public final class PhoneNumbers {
    private static final Pattern PRESENTATION = Pattern.compile(PersonRules.rule("phonePresentationPattern"));
    private static final Pattern CANONICAL = Pattern.compile(PersonRules.rule("canonicalPhonePattern"));
    private static final PhoneNumberUtil NUMBERS = PhoneNumberUtil.getInstance();
    private PhoneNumbers() { }
    public static String normalized(String input) {
        String value = PersonRules.presentation(input);
        if (value == null || value.isEmpty()) return null;
        if(!PRESENTATION.matcher(value).matches()) return value;
        String canonical=value.replaceAll("[ ().\\-\\t\\n\\r]", "");
        // A supplied punctuation-only value is invalid, not a request to clear an optional phone.
        return canonical.isEmpty() ? value : canonical;
    }
    public static String error(String input, boolean required) {
        String value = PersonRules.presentation(input);
        if (value == null || value.isEmpty()) return required ? "Escribe un teléfono de contacto." : null;
        if (!PRESENTATION.matcher(value).matches()) return PersonRules.message("phoneCharacters");
        String canonical = normalized(value);
        if (!canonical.startsWith("+")) return PersonRules.message("phonePrefix");
        if (!CANONICAL.matcher(canonical).matches()) return PersonRules.message("phoneInvalid");
        try {
            var number = NUMBERS.parse(canonical,"ZZ");
            if (!NUMBERS.format(number,PhoneNumberUtil.PhoneNumberFormat.E164).equals(canonical))
                return PersonRules.message("phoneChangedDigits");
            return NUMBERS.isValidNumber(number) ? null : PersonRules.message("phoneInvalid");
        } catch (NumberParseException failure) { return PersonRules.message("phoneInvalid"); }
    }
}
