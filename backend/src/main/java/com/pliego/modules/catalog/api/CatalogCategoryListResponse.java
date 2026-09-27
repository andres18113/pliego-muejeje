package com.pliego.modules.catalog.api;

import java.util.List;

/** Complete flat category hierarchy for public catalog navigation. */
public record CatalogCategoryListResponse(List<Category> items) {

    public CatalogCategoryListResponse {
        items = List.copyOf(items);
    }

    public record Category(String slug, String name, String parentSlug) {
    }
}
