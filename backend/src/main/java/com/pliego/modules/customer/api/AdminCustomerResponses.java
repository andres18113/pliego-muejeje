package com.pliego.modules.customer.api;

/** Wire representations for ADMIN customer endpoints. Database BIGINT identifiers stay strings. */
public final class AdminCustomerResponses {
    private AdminCustomerResponses() { }

    public record CustomerSummary(String customerId, String email, String firstNames, String lastNames,
            String phone, String state, String createdAt) { }
}
