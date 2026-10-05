package com.pliego.modules.library.application;

import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;

/** Purchased digital editions. Content delivery remains outside this ownership contract. */
public final class LibraryModels {
    private LibraryModels() { }
    @Schema(name="LibraryItem")
    public record Item(String ownedItemId, String editionId, @Schema(nullable=true) String coverUrl,
            String title, String authors, @Schema(allowableValues={"EBOOK","AUDIOBOOK"}) String productType,
            @Schema(format="date-time") String acquiredAt, @Schema(allowableValues={"OWNED","REVOKED"}) String ownershipState,
            @Schema(allowableValues={"OWNERSHIP_ONLY","REVOKED"}) String accessState,
            @Schema(description="Siempre false; no se entrega contenido digital en esta simulación.") boolean contentAccessSupported,
            Metadata metadata, List<SourcePurchase> sourcePurchases, List<Action> availableActions) { }
    @Schema(name="LibraryMetadata")
    public record Metadata(@Schema(nullable=true) String isbn, String publisher, String language,
            @Schema(nullable=true) Integer pageCount, @Schema(nullable=true) String publicationDate,
            @Schema(nullable=true) String ebookFileFormat, @Schema(nullable=true) Integer audioDurationSeconds,
            List<String> narrators) { }
    @Schema(name="LibrarySourcePurchase")
    public record SourcePurchase(String orderId, String orderItemId, @Schema(format="date-time") String acquiredAt,
            String paymentState, String orderState, @Schema(allowableValues={"ACTIVE","REVOKED"}) String grantState) { }
    @Schema(name="LibraryAction")
    public record Action(@Schema(allowableValues={"VIEW_ORDER","HELP"}) String type, String label, String href) { }
    public record Page(List<Item> items, long totalCount) { }
}
