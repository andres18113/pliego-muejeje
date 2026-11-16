package com.pliego.modules.customer.api;

import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.PageResponse;
import com.pliego.modules.customer.application.BillingIdentityCorrectionPage;
import com.pliego.modules.customer.application.BillingIdentityCorrectionService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

@Validated
@RestController
@RequestMapping(path = "/api/v1/admin/billing-identity-corrections", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Correcciones de identificación", description = "Revisión administrativa de solicitudes de corrección de identificación de facturación.")
@SecurityRequirement(name = "bearerJwt")
public class AdminBillingIdentityCorrectionController {
    private final BillingIdentityCorrectionService service;

    public AdminBillingIdentityCorrectionController(BillingIdentityCorrectionService service) { this.service = service; }

    @GetMapping
    @Operation(summary = "Listar solicitudes de corrección", description = "Ordena por fecha de vencimiento más antigua primero.")
    public PageResponse<AdminBillingIdentityCorrectionResponses.Request> search(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Pattern(regexp = "PENDING|APPROVED|REJECTED|WITHDRAWN",
                    message = "El estado de la solicitud no es válido.") String status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        BillingIdentityCorrectionPage result = service.search(actorId(jwt), status, page, pageSize);
        return new PageResponse<>(result.items().stream().map(AdminBillingIdentityCorrectionResponses.Request::from).toList(),
                page, pageSize, Long.toString(result.totalCount()));
    }

    @PostMapping(path = "/{requestId}/decision", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Aprobar o rechazar una solicitud")
    public AdminBillingIdentityCorrectionResponses.Decision decide(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive(message = "El identificador de la solicitud debe ser positivo.") long requestId,
            @Valid @RequestBody AdminBillingIdentityCorrectionRequests.Decision request) {
        return AdminBillingIdentityCorrectionResponses.Decision.from(
                service.decide(actorId(jwt), requestId, request.decision(), request.decisionReason()));
    }

    private static long actorId(Jwt jwt) { return Long.parseLong(jwt.getSubject()); }
}
