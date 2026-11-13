package com.pliego.modules.sales.api;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import com.pliego.foundation.web.PageResponse;
import com.pliego.modules.sales.application.PickupModels;
import com.pliego.modules.sales.application.PickupService;
import com.pliego.modules.sales.api.AdminPickupResponses.PickupView;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

@RestController
@Validated
@RequestMapping(produces = "application/json")
@Tag(name = "Retiros administrativos")
@SecurityRequirement(name = "bearerJwt")
public class AdminPickupController {
    private final PickupService service;
    public AdminPickupController(PickupService service) { this.service = service; }

    public record CollectRequest(
            @NotBlank(message = "El código de retiro es obligatorio.")
            @Size(max = 64, message = "El código de retiro no es válido.") String pickupCode,
            @NotNull(message = "Debes confirmar la verificación de identidad.")
            @AssertTrue(message = "Debes verificar la identidad del cliente antes de confirmar el retiro.") Boolean identityVerified) {
        @Override public String toString() { return "CollectRequest[redacted]"; }
    }

    public record LookupRequest(
            @NotBlank(message = "El código de retiro es obligatorio.")
            @Size(max = 64, message = "El código de retiro no es válido.") String code) {
        @Override public String toString() { return "LookupRequest[redacted]"; }
    }

    @PostMapping(path = "/api/v1/admin/orders/{orderId}/pickup/collect", consumes = "application/json")
    @Operation(summary = "Confirmar retiro con identidad verificada",
            description = "Requiere código, identidad verificada y estado READY. Registra el administrador y devuelve el retiro sin su código.")
    public PickupView collect(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long orderId,
            @Valid @RequestBody CollectRequest request) {
        return AdminPickupResponses.view(service.collect(actor(jwt), orderId, request.pickupCode(), request.identityVerified()));
    }

    @PostMapping(path = "/api/v1/admin/pickups/lookup", consumes = "application/json")
    @Operation(summary = "Buscar un retiro por su código", description = "Devuelve el retiro sin exponer su código.")
    public PickupView lookup(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody LookupRequest request) {
        return AdminPickupResponses.view(service.lookup(actor(jwt), request.code()));
    }

    @GetMapping("/api/v1/admin/pickups/{orderId}")
    @Operation(operationId = "getAdminPickup", summary = "Consultar detalle de un retiro", description = "Reconcilia el estado actual y devuelve las acciones permitidas sin código de retiro.")
    public AdminPickupResponses.AdminPickupDetail detail(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive(message = "El identificador del pedido debe ser positivo.") long orderId) {
        return AdminPickupResponses.detail(service.detail(actor(jwt), orderId));
    }

    @PostMapping(path = "/api/v1/admin/pickups/{orderId}/verify-code", consumes = "application/json")
    @Operation(operationId = "verifyAdminPickupCode", summary = "Verificar el código de este retiro", description = "Comprueba el código normalizado sin modificar filas ni reconciliar el estado del pedido.")
    public AdminPickupResponses.AdminPickupDetail verifyCode(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive(message = "El identificador del pedido debe ser positivo.") long orderId,
            @Valid @RequestBody LookupRequest request) {
        return AdminPickupResponses.detail(service.verifyCode(actor(jwt), orderId, request.code()));
    }

    @GetMapping("/api/v1/admin/pickups")
    @Operation(summary = "Consultar retiros", description = "Filtra por estado y referencia pública de pedido.")
    public PageResponse<PickupView> list(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Pattern(regexp = "PENDING|READY|COLLECTED|CANCELLED",
                    message = "El estado de retiro no es válido.") String state,
            @RequestParam(required = false) @Size(max = 100, message = "La búsqueda no puede superar 100 caracteres.") String q,
            @RequestParam(defaultValue = "0") @Min(value = 0, message = "La página no puede ser negativa.") int page,
            @RequestParam(defaultValue = "20") @Min(value = 1, message = "El tamaño de página debe ser al menos 1.")
                    @Max(value = 50, message = "El tamaño de página no puede superar 50.") int pageSize) {
        var result = service.search(actor(jwt), new PickupModels.Search(state, q, page, pageSize));
        return new PageResponse<>(result.items().stream().map(AdminPickupResponses::view).toList(),
                page, pageSize, Long.toString(result.totalCount()));
    }

    private static long actor(Jwt jwt) { return Long.parseLong(jwt.getSubject()); }
}
