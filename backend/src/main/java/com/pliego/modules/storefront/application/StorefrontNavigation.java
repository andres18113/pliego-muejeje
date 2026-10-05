package com.pliego.modules.storefront.application;

import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "StorefrontNavigationResponse")
public record StorefrontNavigation(List<Section> sections) {
    public StorefrontNavigation { sections = List.copyOf(sections); }
    @Schema(name="StorefrontNavigationSection")
    public record Section(@Schema(allowableValues={"PHYSICAL","EBOOK","AUDIOBOOK","OFFERS","HELP"}) String key,
            String label, String href, List<FeaturedProduct> featured, List<Category> categories,
            @Schema(nullable=true) String allHref, @Schema(nullable=true) String bestSellingHref,
            @Schema(nullable=true) String offersHref, String activeOfferCount) {
        public Section { featured = List.copyOf(featured); categories = List.copyOf(categories); }
    }
    @Schema(name="StorefrontFeaturedProduct")
    public record FeaturedProduct(String editionId, String bookId, String title, String authors,
            @Schema(nullable=true) String coverUrl, String format,
            @Schema(allowableValues={"PHYSICAL","EBOOK","AUDIOBOOK"}) String productType,
            String price, @Schema(nullable=true) PromotionalOffer offer, String href) { }
    @Schema(name="StorefrontNavigationCategory")
    public record Category(String slug, String name, @Schema(nullable=true) String parentSlug, String href) { }
    @Schema(name="StorefrontPromotionalOffer")
    public record PromotionalOffer(String offerId, String originalPrice, String discountAmount,
            String startsAt, String endsAt, int daysRemaining, boolean endingSoon,
            @Schema(nullable=true) String offerCopy, @Schema(nullable=true) String terms,
            String effectivePrice, String savingsAmount, String savingsPercent) { }
}
