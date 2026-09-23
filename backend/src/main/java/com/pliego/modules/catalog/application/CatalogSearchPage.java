package com.pliego.modules.catalog.application;

import java.util.List;

public record CatalogSearchPage(List<CatalogEditionSummary> items, long totalCount) {

    public CatalogSearchPage {
        items = List.copyOf(items);
    }
}
