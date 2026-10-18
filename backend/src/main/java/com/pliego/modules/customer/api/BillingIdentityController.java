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
    @Operation(summary = "Actualizar mi identificación de facturación")
    public ResponseEntity<Void> put(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BillingIdentityRequest request) {
        service.set(Long.parseLong(jwt.getSubject()), request.type(), request.number());
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }
    @DeleteMapping
    @Operation(summary = "Eliminar mi identificación de facturación del perfil")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt) {
        service.remove(Long.parseLong(jwt.getSubject()));
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }
}
