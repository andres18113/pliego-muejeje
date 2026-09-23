package com.pliego.modules.customer.application;

public record CustomerProfile(long customerId, String email, String firstNames, String lastNames, String phone,
        String state) {
}
