package com.pliego.modules.sales.api;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import com.pliego.modules.sales.application.PickupService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

@RestController
@Validated
@RequestMapping(path="/api/v1/admin/orders",produces="application/json")
@Tag(name="Administration — Orders")
@SecurityRequirement(name="bearerJwt")
public class AdminPickupController {
    private final PickupService service;
    public AdminPickupController(PickupService service) {this.service=service;}
    public record CollectRequest(@NotNull(message="El código de retiro es obligatorio.")
            @Pattern(regexp="P-[2-9A-HJ-NP-Z]{6,8}",message="El código de retiro no es válido.") String pickupCode) { }
    @PostMapping(path="/{orderId}/pickup/collect",consumes="application/json")
    @Operation(summary="Confirmar retiro del pedido",description="Comando ADMIN con referencia de retiro. Marca el pedido entregado y registra historial; repetirlo no duplica la entrega. La hora estimada no bloquea una entrega preparada antes.")
    public ResponseEntity<Void> collect(@AuthenticationPrincipal Jwt jwt,@PathVariable @Positive long orderId,@Valid @RequestBody CollectRequest request) {
        service.collect(Long.parseLong(jwt.getSubject()),orderId,request.pickupCode());return ResponseEntity.noContent().build();
    }
}
