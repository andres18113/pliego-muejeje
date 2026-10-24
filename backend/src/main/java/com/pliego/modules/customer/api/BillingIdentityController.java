package com.pliego.modules.customer.api;

import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import com.pliego.modules.customer.application.BillingIdentity;
import com.pliego.modules.customer.application.BillingIdentityService;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.Operation;

/**
 * The cédula is required to buy and is not freely editable: it is registered once and changed only
 * by an explicit, re-authenticated correction (ADR 0040). It cannot be removed.
 */
@RestController
@RequestMapping(path = "/api/v1/me/billing-identity", produces = MediaType.APPLICATION_JSON_VALUE)
@SecurityRequirement(name = "bearerJwt")
@io.swagger.v3.oas.annotations.tags.Tag(name = "Billing identity", description = "Identificación privada para facturación académica.")
public class BillingIdentityController {
    private final BillingIdentityService service;
    public BillingIdentityController(BillingIdentityService service) { this.service = service; }
    @GetMapping
    @Operation(summary = "Consultar mi identificación de facturación")
    public ResponseEntity<BillingIdentity> get(@AuthenticationPrincipal Jwt jwt) {
        BillingIdentity result = service.find(Long.parseLong(jwt.getSubject()));
        return result == null ? ResponseEntity.noContent().header("Cache-Control", "no-store").build()
                : ResponseEntity.ok().header("Cache-Control", "no-store").body(result);
    }
    @PutMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Registrar mi cédula",
            description = "Registra la primera cédula. Repetir el mismo número no cambia nada; un número distinto responde P1105 y requiere una corrección.")
    public ResponseEntity<Void> registerBillingIdentity(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BillingIdentityRequest request) {
        service.register(Long.parseLong(jwt.getSubject()), request.type(), request.number());
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }
    @PostMapping(path = "/correction", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Corregir mi cédula",
            description = "Requiere la contraseña actual y la cédula vista. Queda registrada; las facturas anteriores no cambian.")
    public ResponseEntity<Void> correctBillingIdentity(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BillingIdentityCorrectionRequest request) {
        service.correct(Long.parseLong(jwt.getSubject()), request.type(), request.currentNumber(), request.number(), request.currentPassword());
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }
}
