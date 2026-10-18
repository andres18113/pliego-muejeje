package com.pliego.foundation.validation;

import java.util.regex.Pattern;
import com.google.i18n.phonenumbers.PhoneNumberUtil;
import com.google.i18n.phonenumbers.NumberParseException;

/** Metadata version matches libphonenumber-js 1.13.14. Never infer country or discard digits. */
public final class PhoneNumbers {
    private static final Pattern PRESENTATION = Pattern.compile(PersonRules.rule("phonePresentationPattern"));
    private static final Pattern CANONICAL = Pattern.compile(PersonRules.rule("canonicalPhonePattern"));
    private static final int MAX_NATIONAL_DIGITS = Integer.parseInt(PersonRules.rule("maxNationalPhoneDigits"));
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
        if (!canonical.startsWith("+593")) return PersonRules.message("phoneCountry");
        String national = canonical.substring(4);
        if (national.startsWith("0")) return PersonRules.message("phoneChangedDigits");
        if (!national.matches("[0-9]+")) return PersonRules.message("phoneCharacters");
        if (national.length() > MAX_NATIONAL_DIGITS) return PersonRules.message("phoneTooLong");
        if (national.startsWith("9") && national.length() != 9) return PersonRules.message("phoneMobileLength");
        if (national.matches("^[2-7].*") && national.length() != 8) return PersonRules.message("phoneFixedLength");
        if (!national.matches("^[2-79].*")) return PersonRules.message("phoneStart");
        if (!CANONICAL.matcher(canonical).matches()) return PersonRules.message("phoneInvalid");
        try {
            var number = NUMBERS.parse(canonical,"ZZ");
            if (!NUMBERS.format(number,PhoneNumberUtil.PhoneNumberFormat.E164).equals(canonical))
                return PersonRules.message("phoneChangedDigits");
            var type = NUMBERS.getNumberType(number);
            return NUMBERS.isValidNumberForRegion(number,"EC")
                    && (type == PhoneNumberUtil.PhoneNumberType.MOBILE || type == PhoneNumberUtil.PhoneNumberType.FIXED_LINE)
                    ? null : PersonRules.message("phoneInvalid");
        } catch (NumberParseException failure) { return PersonRules.message("phoneInvalid"); }
    }
}
