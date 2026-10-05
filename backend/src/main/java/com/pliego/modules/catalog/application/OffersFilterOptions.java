package com.pliego.modules.catalog.application;

import java.util.List;

public record OffersFilterOptions(List<ProductType> productTypes, List<Category> categories,
        List<Sort> sorts, int endingSoonDays, String timezone, String totalCount) {
    public record ProductType(String code, String label, String count) { }
    public record Category(String slug, String name, String count) { }
    public record Sort(String code, String label) { }
}
