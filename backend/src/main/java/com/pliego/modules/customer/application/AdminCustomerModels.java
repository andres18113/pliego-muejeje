package com.pliego.modules.customer.application;

import java.util.List;

/** Read models and query inputs for the ADMIN customer use cases. */
public final class AdminCustomerModels {
    private AdminCustomerModels() { }

    public record Search(String query, String state, int page, int pageSize) { }

    public record CustomerSummary(String customerId, String email, String firstNames, String lastNames,
            String phone, String state, String createdAt) { }

    public record Page(List<CustomerSummary> items, long totalCount) {
        public Page { items = List.copyOf(items); }
    }
}
