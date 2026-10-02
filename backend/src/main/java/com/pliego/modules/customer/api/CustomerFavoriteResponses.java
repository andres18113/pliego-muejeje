package com.pliego.modules.customer.api;

import java.util.List;

import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;

public final class CustomerFavoriteResponses {

    private CustomerFavoriteResponses() { }

    @Schema(name = "CustomerFavorite")
    public record Favorite(String editionId, String bookId, String title, String authors, String publisher,
            String price, @Schema(nullable = true) String coverUrl, @Schema(nullable = true) String coverLicense,
            @Schema(nullable = true) String coverAttribution,
            String format, String language, boolean available, String favoritedAt) { }

    @Schema(name = "CustomerFavoritePage")
    public record FavoritePage(@ArraySchema(schema = @Schema(implementation = Favorite.class)) List<Favorite> items,
            int page, int pageSize, String totalCount) {
        public FavoritePage {
            items = List.copyOf(items);
        }
    }

    @Schema(name = "CustomerFavoriteStatus")
    public record Status(String editionId, boolean favorite) { }

}
