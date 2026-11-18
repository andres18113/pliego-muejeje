package com.pliego.modules.catalog.application;

public enum EditionUnavailabilityReason {
    OUT_OF_STOCK,
    P2042,
    P2043;

    public static EditionUnavailabilityReason fromNullableCode(String code) {
        return code == null ? null : valueOf(code);
    }
}
