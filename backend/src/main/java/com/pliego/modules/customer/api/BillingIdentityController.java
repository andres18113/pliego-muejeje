package com.pliego.modules.customer.api;

import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.Valid;
import com.pliego.modules.customer.application.BillingIdentity;
import com.pliego.modules.customer.application.BillingIdentityCorrection;
import com.pliego.modules.customer.application.BillingIdentityCorrectionService;
import com.pliego.modules.customer.application.BillingIdentityService;
import java.net.URI;
import java.util.UUID;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.Operation;

/**
 * Billing identity is registered once and corrected under the database-owned invoice-use tiers (ADR-0043).
 * It cannot be removed; issued and draft invoices keep their own snapshots.
 */
@RestController
@Validated
@RequestMapping(path = "/api/v1/me/billing-identity", produces = MediaType.APPLICATION_JSON_VALUE)
@SecurityRequirement(name = "bearerJwt")
@io.swagger.v3.oas.annotations.tags.Tag(name = "Billing identity", description = "Identificación privada para facturación académica.")
public class BillingIdentityController {
    private final BillingIdentityService service;
    private final BillingIdentityCorrectionService corrections;
    public BillingIdentityController(BillingIdentityService service, BillingIdentityCorrectionService corrections) {
        this.service = service;
        this.corrections = corrections;
    }
    @GetMapping
    @Operation(summary = "Consultar mi identificación de facturación")
    public ResponseEntity<BillingIdentity> get(@AuthenticationPrincipal Jwt jwt) {
        BillingIdentity result = service.find(Long.parseLong(jwt.getSubject()));
        return result == null ? ResponseEntity.noContent().header("Cache-Control", "no-store").build()
                : ResponseEntity.ok().header("Cache-Control", "no-store").body(result);
    }
    @PutMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Registrar mi identificación",
            description = "Registra la primera cédula o RUC. Repetir el mismo número no cambia nada; un número distinto responde P1105 y requiere una corrección.")
    public ResponseEntity<Void> registerBillingIdentity(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BillingIdentityRequest request) {
        service.register(Long.parseLong(jwt.getSubject()), request.type(), request.number());
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }
    @PostMapping(path = "/correction", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Corregir mi identificación",
            description = "Usa el número que ves como comparación. No requiere contraseña; el campo legado currentPassword se acepta y se ignora. Los cambios de identificaciones usadas que no sean cédula↔RUC de la misma persona requieren revisión.")
    public ResponseEntity<Void> correctBillingIdentity(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BillingIdentityCorrectionRequest request) {
        service.correct(Long.parseLong(jwt.getSubject()), request.type(), request.currentNumber(), request.number());
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }

    @PostMapping(path = "/correction-requests", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Solicitar revisión de una corrección de identificación",
            description = "Crea una solicitud para un cambio que ya requiere revisión. Idempotency-Key identifica la solicitud.")
    public ResponseEntity<BillingIdentityCorrection> requestCorrection(@AuthenticationPrincipal Jwt jwt,
            @RequestHeader("Idempotency-Key") UUID key,
            @Valid @RequestBody BillingIdentityCorrectionRequests.Submit request) {
        BillingIdentityCorrection result = corrections.submit(Long.parseLong(jwt.getSubject()), key,
                request.currentNumber(), request.type(), request.number(), request.reasonCode(), request.note());
        URI location = URI.create("/api/v1/me/billing-identity/correction-requests/" + result.id());
        return ResponseEntity.created(location).header("Cache-Control", "no-store").body(result);
    }

    @PostMapping(path = "/correction-requests/{requestId}/withdraw")
    @Operation(summary = "Retirar mi solicitud pendiente de corrección")
    public ResponseEntity<Void> withdrawCorrection(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @jakarta.validation.constraints.Positive long requestId) {
        corrections.withdraw(Long.parseLong(jwt.getSubject()), requestId);
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }

}
