package com.pliego.modules.customer.application;

import java.util.List;

public record BillingIdentityCorrectionPage(List<AdminBillingIdentityCorrection> items, long totalCount) {
    public BillingIdentityCorrectionPage { items = List.copyOf(items); }
}
