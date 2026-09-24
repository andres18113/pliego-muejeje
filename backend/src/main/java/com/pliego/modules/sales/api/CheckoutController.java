package com.pliego.modules.sales.api;

import java.math.RoundingMode;
import java.net.URI;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.sales.application.CardNumberValidator;
import com.pliego.modules.sales.application.CheckoutResult;
import com.pliego.modules.sales.application.CheckoutService;
import com.pliego.modules.sales.application.InvalidCardNumberException;

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
    @Operation(summary = "Finalizar compra", description = "El resultado simulado es determinista. Tras una respuesta desconocida, consulta los pedidos antes de crear otro intento; no reintentes automáticamente.")
    @ApiResponse(responseCode = "201", description = "Pedido creado, con pago aprobado o rechazado")
    @ApiResponse(responseCode = "400", description = "Solicitud inválida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<CheckoutResponse> checkout(@AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CheckoutRequest request) {
        validateCard(request);
        CheckoutResult result = service.checkout(Long.parseLong(jwt.getSubject()), Long.parseLong(request.addressId()),
                request.paymentMethod(), request.simulationOutcome());
        URI location = URI.create("/api/v1/orders/" + result.orderId());
        return ResponseEntity.created(location).body(new CheckoutResponse(result.orderId(), result.orderState(),
                result.paymentState(), result.total().setScale(2, RoundingMode.UNNECESSARY).toPlainString(),
                result.paymentReference()));
    }

    private static void validateCard(CheckoutRequest request) {
        if ("CARD".equals(request.paymentMethod())) {
            if (!CardNumberValidator.isValid(request.cardNumber())) throw new InvalidCardNumberException();
        } else if ("TRANSFER".equals(request.paymentMethod()) && request.cardNumber() != null) {
            throw new InvalidCardNumberException();
        }
    }
}
