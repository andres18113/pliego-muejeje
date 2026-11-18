package com.pliego.modules.customer.application;

public record CustomerAddress(long addressId, String alias, String recipient, String line1, String line2,
        String city, String province, Long provinceId, Long cityId, boolean cityNeedsReview,
        String countryCode, String postalCode, String reference, String phone, boolean primary) {
}
