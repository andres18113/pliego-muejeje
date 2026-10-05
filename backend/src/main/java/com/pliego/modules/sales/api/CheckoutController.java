package com.pliego.modules.sales.api;

import java.math.RoundingMode;
import java.net.URI;
import java.util.UUID;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.PathVariable;

import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.sales.application.CardNumberValidator;
import com.pliego.modules.sales.application.CheckoutResult;
import com.pliego.modules.sales.application.CheckoutService;
import com.pliego.modules.sales.application.InvalidCardNumberException;
import com.pliego.modules.sales.application.CheckoutAttempt;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@RestController
@RequestMapping(path = "/api/v1/checkout", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Checkout", description = "Finaliza el carrito mediante un pago académico simulado.")
@SecurityRequirement(name = "bearerJwt")
public class CheckoutController {

    private final CheckoutService service;

    public CheckoutController(CheckoutService service) {
        this.service = service;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Finalizar compra simulada", description = "No realiza cobros reales. Idempotency-Key identifica el intento; repetirlo devuelve el resultado original. Resuelve una respuesta perdida mediante el intento exacto.")
    @ApiResponse(responseCode = "201", description = "Pedido creado, con pago aprobado o rechazado")
    @ApiResponse(responseCode = "400", description = "Solicitud inválida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<CheckoutResponse> checkout(@AuthenticationPrincipal Jwt jwt,
            @RequestHeader("Idempotency-Key") UUID key,
            @Valid @RequestBody CheckoutRequest request) {
        validateCard(request);
        CheckoutResult result = service.checkout(Long.parseLong(jwt.getSubject()), key, request.addressId() == null ? null : Long.valueOf(request.addressId()),
                request.paymentMethod(), request.simulationOutcome(),
                request.expectedCartId() == null ? null : Long.valueOf(request.expectedCartId()), request.fulfillmentMethod(),
                request.pickupLocationId() == null ? null : Long.valueOf(request.pickupLocationId()));
        URI location = URI.create("/api/v1/orders/" + result.orderId());
        return ResponseEntity.created(location).body(toResponse(result));
    }

    @PostMapping("/attempts/{key}/resolve")
    @Operation(summary = "Resolver un intento de compra", description = "PENDING mantiene el resultado sin resolver. CREATED identifica el pedido exacto. NOT_CREATED bloquea permanentemente el intento antes de confirmar ausencia, incluso si la petición original llega tarde.")
    @ApiResponse(responseCode = "200", description = "Resultado del intento", content = @Content(schema = @Schema(implementation = CheckoutAttemptResponse.class)))
    public CheckoutAttemptResponse resolve(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID key) {
        CheckoutAttempt attempt = service.resolve(Long.parseLong(jwt.getSubject()), key);
        return new CheckoutAttemptResponse(attempt.state(), attempt.order() == null ? null : toResponse(attempt.order()));
    }

    private static CheckoutResponse toResponse(CheckoutResult result) {
        return new CheckoutResponse(result.orderId(), result.orderState(),
                result.paymentState(), result.total().setScale(2, RoundingMode.UNNECESSARY).toPlainString(),
                result.paymentReference(), result.fulfillment(),money(result.amounts().subtotal()),money(result.amounts().taxRate()),
                money(result.amounts().taxAmount()),money(result.amounts().shippingAmount()));
    }

    private static String money(java.math.BigDecimal value) {return value.setScale(2,RoundingMode.UNNECESSARY).toPlainString();}

    private static void validateCard(CheckoutRequest request) {
        if ("CARD".equals(request.paymentMethod())) {
            if (!CardNumberValidator.isValid(request.cardNumber())) throw new InvalidCardNumberException();
        } else if ("TRANSFER".equals(request.paymentMethod()) && request.cardNumber() != null) {
            throw new InvalidCardNumberException();
        }
    }
}
