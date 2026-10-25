package com.pliego.modules.billing.api;

import java.nio.charset.StandardCharsets;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import com.pliego.modules.billing.application.BillingService;
import com.pliego.modules.billing.application.InvoiceDownload;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import tools.jackson.databind.JsonNode;

@RestController
@Validated
@io.swagger.v3.oas.annotations.tags.Tag(name = "Billing", description = "Documentos académicos privados del pedido.")
@io.swagger.v3.oas.annotations.security.SecurityRequirement(name = "bearerJwt")
@RequestMapping({"/api/v1/orders/{orderId}/invoice", "/api/v1/admin/orders/{orderId}/invoice"})
public class BillingController {
    private final BillingService service;
    public BillingController(BillingService service) { this.service = service; }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    @io.swagger.v3.oas.annotations.Operation(summary = "Consultar el estado de la factura académica")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", content = @io.swagger.v3.oas.annotations.media.Content(
            schema = @io.swagger.v3.oas.annotations.media.Schema(implementation = InvoiceMetadataResponse.class)))
    public ResponseEntity<?> metadata(@AuthenticationPrincipal Jwt jwt,
            @io.swagger.v3.oas.annotations.Parameter(schema = @io.swagger.v3.oas.annotations.media.Schema(type = "string", pattern = "^[1-9][0-9]*$"))
            @PathVariable @Positive long orderId) {
        JsonNode metadata = service.metadata(Long.parseLong(jwt.getSubject()), orderId);
        if (metadata == null) return problem(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND", "Factura no disponible", "El pedido todavía no tiene una factura.");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(metadata);
    }

    @GetMapping("/files/{type}")
    @io.swagger.v3.oas.annotations.Operation(summary = "Descargar un documento académico autenticado",
            description = "Se entrega como adjunto por defecto. disposition=inline permite visualizar únicamente PDF; XML siempre se descarga como adjunto.")
    @io.swagger.v3.oas.annotations.responses.ApiResponse(responseCode = "200", content = {
            @io.swagger.v3.oas.annotations.media.Content(mediaType = "application/pdf", schema = @io.swagger.v3.oas.annotations.media.Schema(type = "string", format = "binary")),
            @io.swagger.v3.oas.annotations.media.Content(mediaType = "application/xml", schema = @io.swagger.v3.oas.annotations.media.Schema(type = "string", format = "binary"))})
    public ResponseEntity<?> download(@AuthenticationPrincipal Jwt jwt,
            @io.swagger.v3.oas.annotations.Parameter(schema = @io.swagger.v3.oas.annotations.media.Schema(type = "string", pattern = "^[1-9][0-9]*$"))
            @PathVariable @Positive long orderId,
            @PathVariable @Pattern(regexp = "PDF|XML", message = "El formato debe ser PDF o XML.") String type,
            @io.swagger.v3.oas.annotations.Parameter(description = "Presentación del archivo; inline solo admite PDF.",
                    schema = @io.swagger.v3.oas.annotations.media.Schema(allowableValues = {"attachment", "inline"}, defaultValue = "attachment"))
            @RequestParam(defaultValue = "attachment") String disposition) {
        if (!"attachment".equals(disposition) && !("inline".equals(disposition) && "PDF".equals(type))) {
            return problem(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Datos inválidos",
                    "La presentación debe ser attachment o inline. La visualización inline solo está disponible para PDF.");
        }
        InvoiceDownload file = service.download(Long.parseLong(jwt.getSubject()), orderId, type);
        if (file == null) {
            JsonNode metadata = service.metadata(Long.parseLong(jwt.getSubject()), orderId);
            if (metadata != null && "LEGACY".equals(metadata.path("provenance").asString())) {
                return problem(HttpStatus.NOT_FOUND, "INVOICE_FILE_UNAVAILABLE", "Documento no disponible",
                        "El archivo de esta factura histórica no está disponible para descarga.");
            }
            return problem(HttpStatus.CONFLICT, "INVOICE_FILE_NOT_READY", "Documento en preparación",
                    "La compra está registrada. El documento todavía se está preparando; consulta nuevamente en unos momentos.");
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType(file.mimeType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.builder(disposition)
                        .filename(file.fileName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .contentLength(file.content().length).body(file.content());
    }

    private static ResponseEntity<ProblemDetail> problem(HttpStatus status, String code, String title, String detail) {
        ProblemDetail body = ProblemDetail.forStatusAndDetail(status, detail);
        body.setTitle(title); body.setProperty("code", code);
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(body);
    }
}
