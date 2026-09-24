package com.pliego.modules.sales.application;

/** Local validation for the academic CARD request; no card data reaches persistence. */
public final class CardNumberValidator {

    private CardNumberValidator() { }

    public static boolean isValid(String number) {
        if (number == null || number.length() < 12 || number.length() > 19) return false;
        int sum = 0;
        boolean doubleDigit = false;
        for (int index = number.length() - 1; index >= 0; index--) {
            char character = number.charAt(index);
            if (character < '0' || character > '9') return false;
            int digit = character - '0';
            if (doubleDigit) {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }
            sum += digit;
            doubleDigit = !doubleDigit;
        }
        return sum % 10 == 0;
    }
}
