package com.pliego.modules.customer.application;

public record AddressInput(String alias, String recipient, String line1, String line2, String city,
        String province, String countryCode, String postalCode, String reference, String phone) {
}
