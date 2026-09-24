package com.pliego.modules.sales.api;

import java.math.BigDecimal;
import java.math.RoundingMode;

import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.PageResponse;
import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.sales.api.CustomerOrderResponses.Address;
import com.pliego.modules.sales.api.CustomerOrderResponses.Cancellation;
import com.pliego.modules.sales.api.CustomerOrderResponses.Detail;
import com.pliego.modules.sales.api.CustomerOrderResponses.History;
import com.pliego.modules.sales.api.CustomerOrderResponses.Item;
import com.pliego.modules.sales.api.CustomerOrderResponses.Payment;
import com.pliego.modules.sales.api.CustomerOrderResponses.Summary;
import com.pliego.modules.sales.application.CustomerOrderService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;

@Validated
@RestController
@RequestMapping(path = "/api/v1/orders", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Pedidos", description = "Consulta y cancelación de pedidos del cliente autenticado.")
@SecurityRequirement(name = "bearerJwt")
public class CustomerOrderController {

    private final CustomerOrderService service;

    public CustomerOrderController(CustomerOrderService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Consultar pedidos propios", description = "Ordenados por fecha de creación y número de pedido descendentes.")
    @ApiResponse(responseCode = "200", description = "Página de pedidos", content = @Content(schema = @Schema(implementation = PageResponse.class)))
    public PageResponse<Summary> list(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        var result = service.list(actorId(jwt), page, pageSize);
        return new PageResponse<>(result.items().stream().map(order -> new Summary(order.orderId(),
                order.createdAt().toString(), order.orderState(), money(order.total()),
                order.paymentState())).toList(), page, pageSize, Long.toString(result.totalCount()));
    }

    @GetMapping("/{orderId}")
    @Operation(summary = "Consultar detalle de un pedido propio")
    @ApiResponse(responseCode = "200", description = "Detalle completo del pedido")
    @ApiResponse(responseCode = "404", description = "Pedido no disponible", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public Detail detail(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long orderId) {
        var order = service.detail(actorId(jwt), orderId);
        var address = order.address();
        var payment = order.payment();
        return new Detail(order.orderId(), order.orderState(), money(order.subtotal()), money(order.total()),
                order.createdAt().toString(), order.updatedAt().toString(),
                order.items().stream().map(item -> new Item(item.orderItemId(), item.editionId(), item.sku(),
                        item.isbn(), item.title(), item.authors(), item.publisher(), item.format(),
                        item.language(), money(item.unitPrice()), item.quantity(), money(item.subtotal()))).toList(),
                new Address(address.recipient(), address.line1(), address.line2(), address.city(),
                        address.province(), address.countryCode(), address.postalCode(), address.reference(),
                        address.phone()),
                new Payment(payment.paymentId(), payment.method(), payment.state(), money(payment.amount()),
                        payment.reference(), payment.resultDetail(), payment.createdAt(), payment.updatedAt()),
                order.stateHistory().stream().map(history -> new History(history.historyId(),
                        history.actorUserId(), history.origin(), history.previousState(), history.newState(),
                        history.at())).toList());
    }

    @PostMapping("/{orderId}/cancel")
    @Operation(summary = "Cancelar un pedido propio", description = "Si se pierde la respuesta, consulta el detalle del pedido antes de intentar otra cancelación.")
    @ApiResponse(responseCode = "200", description = "Pedido cancelado y pago reembolsado")
    @ApiResponse(responseCode = "404", description = "Pedido no disponible", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "409", description = "Pedido no cancelable", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public Cancellation cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long orderId) {
        var result = service.cancel(actorId(jwt), orderId);
        return new Cancellation(result.orderId(), result.previousState(), result.orderState(),
                result.paymentState(), result.restoredUnits());
    }

    private static String money(BigDecimal value) {
        return value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
    }

    private static long actorId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
