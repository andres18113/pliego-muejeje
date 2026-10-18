package com.pliego.foundation.validation;

/** Format and checksum validation only; does not establish ownership or civil identity. */
public final class EcuadorianCedula {
    public static final String MESSAGE = "Ingresa una cédula ecuatoriana válida de 10 dígitos";
    private EcuadorianCedula() { }
    /** Same external ASCII-space normalization as PostgreSQL btrim(text). */
    public static String normalized(String input) {
        if (input == null) return null;
        int start = 0, end = input.length();
        while (start < end && input.charAt(start) == ' ') start++;
        while (end > start && input.charAt(end - 1) == ' ') end--;
        return input.substring(start, end);
    }
    public static boolean isValid(String input) {
        String value = normalized(input);
        if (value == null || value.length() != 10) return false;
        int sum = 0;
        boolean repeated = true;
        for (int i = 0; i < 10; i++) {
            char digit = value.charAt(i);
            if (digit < '0' || digit > '9') return false;
            repeated &= digit == value.charAt(0);
            if (i < 9) {
                int product = (digit - '0') * (i % 2 == 0 ? 2 : 1);
                sum += product > 9 ? product - 9 : product;
            }
        }
        return !repeated && (10 - sum % 10) % 10 == value.charAt(9) - '0';
    }
}
