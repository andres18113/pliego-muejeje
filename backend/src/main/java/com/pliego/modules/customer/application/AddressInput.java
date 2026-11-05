package com.pliego.modules.customer.application;

public record AddressInput(String alias, String recipient, String line1, String line2, String provinceId,
        String cityId, String countryCode, String postalCode, String reference, String phone, String city, String province) {
}
