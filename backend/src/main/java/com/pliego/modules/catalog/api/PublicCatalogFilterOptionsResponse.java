package com.pliego.modules.catalog.api;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** Database-backed filter values for the public catalog. Prices remain strings at the JSON boundary. */
public record PublicCatalogFilterOptionsResponse(
        List<String> languages,
        @Schema(description = "Formatos presentes en ediciones publicables", example = "[\"HARDCOVER\",\"PAPERBACK\"]") List<String> formats,
        @Schema(nullable = true, pattern = "[0-9]{1,9}\\.[0-9]{2}") String minimumPrice,
        @Schema(nullable = true, pattern = "[0-9]{1,9}\\.[0-9]{2}") String maximumPrice) {

    public PublicCatalogFilterOptionsResponse {
        languages = List.copyOf(languages);
        formats = List.copyOf(formats);
    }
}
