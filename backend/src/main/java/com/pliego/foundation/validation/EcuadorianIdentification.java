package com.pliego.foundation.validation;

/**
 * Ecuadorian cédula and RUC by algorithm only (ADR 0041); it never establishes existence or ownership.
 * Same rules as PostgreSQL {@code fn_is_valid_ec_identification} and the frontend; shared fixtures in
 * {@code shared/validation/ec-identification-cases.json}.
 */
public final class EcuadorianIdentification {
    public static final String CEDULA = "EC_CEDULA";
    public static final String RUC = "EC_RUC";
    public static final String MESSAGE = "Ingresa una cédula (10 dígitos) o un RUC (13 dígitos) válidos";
    private static final int[] PUBLIC_WEIGHTS = {3, 2, 7, 6, 5, 4, 3, 2};
    private static final int[] PRIVATE_WEIGHTS = {4, 3, 2, 7, 6, 5, 4, 3, 2};

    private EcuadorianIdentification() { }

    /** Same external ASCII-space trimming as PostgreSQL btrim(text, ' '). */
    public static String normalized(String input) {
        if (input == null) return null;
        int start = 0, end = input.length();
        while (start < end && input.charAt(start) == ' ') start++;
        while (end > start && input.charAt(end - 1) == ' ') end--;
        return input.substring(start, end);
    }

    public static boolean isValid(String type, String input) {
        String value = normalized(input);
        if (value == null || !(CEDULA.equals(type) && digits(value, 10) || RUC.equals(type) && digits(value, 13))) return false;
        int province = Integer.parseInt(value.substring(0, 2)), third = value.charAt(2) - '0';
        if (!(province >= 1 && province <= 24 || province == 30)) return false;
        if (third < 6) {
            if (value.substring(0, 10).chars().distinct().count() == 1 || moduloTen(value) != value.charAt(9) - '0') return false;
            return CEDULA.equals(type) || !value.endsWith("000");
        }
        if (!RUC.equals(type)) return false;
        if (third == 6) return moduloEleven(value, PUBLIC_WEIGHTS) == value.charAt(8) - '0' && !value.substring(9).equals("0000");
        if (third == 9) return moduloEleven(value, PRIVATE_WEIGHTS) == value.charAt(9) - '0' && !value.endsWith("000");
        return false;
    }

    private static boolean digits(String value, int length) {
        if (value.length() != length) return false;
        for (int i = 0; i < length; i++) if (value.charAt(i) < '0' || value.charAt(i) > '9') return false;
        return true;
    }

    private static int moduloTen(String value) {
        int sum = 0;
        for (int i = 0; i < 9; i++) {
            int product = (value.charAt(i) - '0') * (i % 2 == 0 ? 2 : 1);
            sum += product > 9 ? product - 9 : product;
        }
        return (10 - sum % 10) % 10;
    }

    /** Returns -1 when the remainder leaves no valid check digit (11 - r = 10). */
    private static int moduloEleven(String value, int[] weights) {
        int sum = 0;
        for (int i = 0; i < weights.length; i++) sum += (value.charAt(i) - '0') * weights[i];
        int check = 11 - sum % 11;
        return check == 11 ? 0 : check == 10 ? -1 : check;
    }
}
