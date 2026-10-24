package com.pliego.modules.billing.api;

import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;

/** Public metadata contract; excludes buyer identification and private storage references. */
@Schema(name = "InvoiceMetadata")
public record InvoiceMetadataResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String invoiceId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String orderId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"DRAFT", "ISSUED", "VOID"}) String state,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"SIMULATED", "LEGACY"}) String provenance,
        @Schema(nullable = true) String documentNumber,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<FileStatus> files) {
    public record FileStatus(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"PDF", "XML"}) String type,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"PENDING", "PROCESSING", "READY", "FAILED", "UNAVAILABLE"}) String state) { }
}
