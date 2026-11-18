package com.pliego.modules.customer.application;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import com.pliego.modules.catalog.application.EditionUnavailabilityReason;

public final class CustomerFavorites {

    private CustomerFavorites() { }

    public record Favorite(long editionId, long bookId, String title, String authors, String publisher,
            BigDecimal price, String coverUrl, String coverLicense, String coverAttribution,
            String format, String language, boolean available, EditionUnavailabilityReason unavailabilityReason,
            Instant favoritedAt) { }

    public record Status(long editionId, boolean favorite) { }

    public record Page(List<Favorite> items, long totalCount) {
        public Page {
            items = List.copyOf(items);
        }
    }
}
