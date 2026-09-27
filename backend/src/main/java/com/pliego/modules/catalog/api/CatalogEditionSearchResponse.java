package com.pliego.modules.catalog.api;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** OpenAPI schema for the public edition search page. */
@Schema(name = "CatalogEditionSearchResponse")
public record CatalogEditionSearchResponse(List<CatalogEditionSummaryResponse> items, int page,
        int pageSize, String totalCount) {
}
