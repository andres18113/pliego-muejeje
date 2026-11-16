package com.pliego.modules.billing.api;

import java.time.Instant;
import com.pliego.modules.billing.application.InvoiceDocumentAccess;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "InvoiceDocumentAccess", description = "Instrucción privada para visualizar el PDF de la factura.")
public record InvoiceDocumentAccessResponse(
        @Schema(allowableValues = {"API_STREAM", "SIGNED_URL"}) String delivery,
        String url,
        @Schema(nullable = true, format = "date-time") Instant expiresAt) {
    public static InvoiceDocumentAccessResponse from(InvoiceDocumentAccess access) {
        return new InvoiceDocumentAccessResponse(access.delivery(), access.url(), access.expiresAt());
    }
}
