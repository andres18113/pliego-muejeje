package com.pliego.modules.catalog.application;

import java.math.BigDecimal;
import java.util.List;

public record PublicCatalogFilterOptions(List<String> languages, BigDecimal minimumPrice, BigDecimal maximumPrice) {

    public PublicCatalogFilterOptions {
        languages = List.copyOf(languages);
    }
}
