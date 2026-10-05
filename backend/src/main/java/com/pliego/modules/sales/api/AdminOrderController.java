package com.pliego.modules.sales.api;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PutMapping;
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
import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.sales.api.AdminOrderResponses.Address;
import com.pliego.modules.sales.api.AdminOrderResponses.Cancellation;
import com.pliego.modules.sales.api.AdminOrderResponses.Detail;
import com.pliego.modules.sales.api.AdminOrderResponses.History;
import com.pliego.modules.sales.api.AdminOrderResponses.InventoryMovement;
import com.pliego.modules.sales.api.AdminOrderResponses.Item;
import com.pliego.modules.sales.api.AdminOrderResponses.Payment;
import com.pliego.modules.sales.api.AdminOrderResponses.Summary;
import com.pliego.modules.sales.api.AdminOrderResponses.Transition;
import com.pliego.modules.sales.application.AdminOrderModels.Search;
import com.pliego.modules.sales.application.AdminOrderService;
import com.pliego.modules.sales.application.PostPurchaseModels;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;

@Validated
@RestController
@RequestMapping(path = "/api/v1/admin/orders", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Pedidos administrativos", description = "Consulta y gestión logística de pedidos.")
@SecurityRequirement(name = "bearerJwt")
public class AdminOrderController {

    private final AdminOrderService service;

    public AdminOrderController(AdminOrderService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Buscar pedidos", description = "Filtros y orden definidos por fn_admin_orders.")
    @ApiResponse(responseCode = "200", description = "Página de pedidos")
    public PageResponse<Summary> search(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) OffsetDateTime dateFrom,
            @RequestParam(required = false) OffsetDateTime dateTo,
            @RequestParam(required = false) @Positive Long customerId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        var result = service.search(actorId(jwt), new Search(state, dateFrom, dateTo, customerId, page, pageSize));
        return new PageResponse<>(result.items().stream().map(order -> new Summary(order.orderId(),
                order.customerId(), order.customerName(), order.createdAt().toString(), order.orderState(),
                money(order.total()), order.paymentState())).toList(), page, pageSize,
                Long.toString(result.totalCount()));
    }

    @GetMapping("/{orderId}")
    @Operation(summary = "Consultar detalle administrativo de un pedido")
    @ApiResponse(responseCode = "200", description = "Pedido con snapshots, historial y movimientos relacionados")
    @ApiResponse(responseCode = "404", description = "Pedido no encontrado", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public Detail detail(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long orderId) {
        var order = service.detail(actorId(jwt), orderId);
        var address = order.address();
        var payment = order.payment();
        var post = order.postPurchase();
        return new Detail(order.orderId(), order.customerId(), order.customerEmail(), order.customerName(),
                order.orderState(), money(order.subtotal()), money(order.total()), order.createdAt().toString(),
                order.updatedAt().toString(), order.items().stream().map(item -> new Item(item.orderItemId(),
                        item.editionId(), item.sku(), item.isbn(), item.title(), item.authors(), item.publisher(),
                        item.format(), item.language(), money(item.unitPrice()), item.quantity(),
                        money(item.subtotal()))).toList(),
                address==null ? null : new Address(address.recipient(), address.line1(), address.line2(), address.city(),
                        address.province(), address.countryCode(), address.postalCode(), address.reference(),
                        address.phone()),
                new Payment(payment.paymentId(), payment.method(), payment.state(), money(payment.amount()),
                        payment.reference(), payment.resultDetail(), payment.createdAt(), payment.updatedAt()),
                order.stateHistory().stream().map(history -> new History(history.historyId(),
                        history.actorUserId(), history.origin(), history.previousState(), history.newState(),
                        history.at())).toList(),
                order.inventoryMovements().stream().map(movement -> new InventoryMovement(
                        movement.movementId(), movement.editionId(), movement.orderId(), movement.actorUserId(),
                        movement.type(), movement.quantity(), movement.stockBefore(), movement.stockAfter(),
                        movement.reason(), movement.eventAt())).toList(),post.purchaseState(),post.fulfillment(),post.shipment(),
                PostPurchaseResponses.invoice(post.invoice()),PostPurchaseResponses.creditNotes(post.creditNotes()),post.availableActions(),
                money(post.amounts().taxRate()),money(post.amounts().taxAmount()),money(post.amounts().shippingAmount()));
    }

    @PostMapping(path = "/{orderId}/transitions", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Avanzar el estado logístico del pedido",
            description = "Si se pierde la respuesta, consulta el detalle antes de decidir una nueva transición.")
    @ApiResponse(responseCode = "200", description = "Transición registrada")
    @ApiResponse(responseCode = "404", description = "Pedido no encontrado", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "409", description = "Transición no permitida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public Transition transition(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long orderId,
            @Valid @RequestBody AdminOrderRequests.Transition request) {
        var result = service.transition(actorId(jwt), orderId, request.targetState());
        return new Transition(result.orderId(), result.previousState(), result.orderState());
    }

    @PostMapping("/{orderId}/cancel")
    @Operation(summary = "Cancelar un pedido elegible",
            description = "Si se pierde la respuesta, consulta el detalle del pedido antes de repetir.")
    @ApiResponse(responseCode = "200", description = "Pedido cancelado y pago reembolsado")
    @ApiResponse(responseCode = "404", description = "Pedido no encontrado", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "409", description = "Pedido no cancelable", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public Cancellation cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long orderId) {
        var result = service.cancel(actorId(jwt), orderId);
        return new Cancellation(result.orderId(), result.previousState(), result.orderState(),
                result.paymentState(), result.restoredUnits());
    }

    private static String money(BigDecimal value) {
        return value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
    }

    @PostMapping(path="/{orderId}/shipment/transitions",consumes=MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary="Avanzar el estado del envío",description="Consulta el detalle después de una respuesta desconocida antes de repetir el comando.")
    public PostPurchaseResponses.ShipmentResult transitionShipment(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long orderId,@Valid @RequestBody PostPurchaseRequests.ShipmentTransition request) {
        return new PostPurchaseResponses.ShipmentResult(Long.toString(orderId),
                service.transitionShipment(actorId(jwt),orderId,request.targetState()));
    }

    @PutMapping(path="/{orderId}/shipment/tracking",consumes=MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary="Actualizar seguimiento y ventana estimada",description="Reemplaza los datos de seguimiento del envío y registra un evento histórico.")
    public PostPurchaseResponses.ShipmentResult updateTracking(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long orderId,@Valid @RequestBody PostPurchaseRequests.Tracking request) {
        return new PostPurchaseResponses.ShipmentResult(Long.toString(orderId),service.updateTracking(actorId(jwt),orderId,
                new PostPurchaseModels.Tracking(request.carrier(),request.trackingCode(),request.trackingUrl(),
                        request.estimatedDeliveryFrom(),request.estimatedDeliveryTo())));
    }

    @PostMapping(path="/{orderId}/invoice",consumes=MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary="Emitir documento comercial del pedido",description="Preserva identidad y dirección de cobro explícitas. No realiza autorización fiscal ni integración con SRI. Consulta el detalle antes de repetir tras una respuesta desconocida.")
    @ApiResponse(responseCode="201",description="Documento comercial emitido")
    public ResponseEntity<PostPurchaseResponses.IssuedInvoice> issueInvoice(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long orderId,@Valid @RequestBody PostPurchaseRequests.Invoice request) {
        var address=request.billingAddress();
        long id=service.issueInvoice(actorId(jwt),orderId,new PostPurchaseModels.IssueInvoice(request.documentNumber(),
                request.buyerName(),request.identityType(),request.identityNumber(),request.buyerEmail(),
                new PostPurchaseModels.BillingAddress(address.line1(),address.line2(),address.city(),address.province(),
                        address.countryCode(),address.postalCode())));
        return ResponseEntity.created(java.net.URI.create("/api/v1/admin/orders/"+orderId))
                .body(new PostPurchaseResponses.IssuedInvoice(Long.toString(orderId),Long.toString(id)));
    }

    @PostMapping(path="/{orderId}/credit-notes",consumes=MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary="Emitir nota de crédito total",description="Requiere pago reembolsado y factura emitida. Conserva la factura original; no implementa correcciones parciales ni integración fiscal.")
    @ApiResponse(responseCode="201",description="Nota de crédito emitida")
    public ResponseEntity<PostPurchaseResponses.IssuedCreditNote> issueCreditNote(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long orderId,@Valid @RequestBody PostPurchaseRequests.CreditNote request) {
        long id=service.issueCreditNote(actorId(jwt),orderId,request.documentNumber(),request.reason());
        return ResponseEntity.created(java.net.URI.create("/api/v1/admin/orders/"+orderId))
                .body(new PostPurchaseResponses.IssuedCreditNote(Long.toString(orderId),Long.toString(id)));
    }

    private static long actorId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
