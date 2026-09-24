package com.pliego.modules.cart.api;

import java.math.BigDecimal;
import java.math.RoundingMode;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.cart.api.CartRequests.AddItem;
import com.pliego.modules.cart.api.CartRequests.Quantity;
import com.pliego.modules.cart.api.CartResponses.Cart;
import com.pliego.modules.cart.api.CartResponses.Item;
import com.pliego.modules.cart.api.CartResponses.ItemMutation;
import com.pliego.modules.cart.application.CartModels.CartItem;
import com.pliego.modules.cart.application.CartModels.CartItemResult;
import com.pliego.modules.cart.application.CartService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;

@Validated
@RestController
@RequestMapping(path = "/api/v1/cart", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Carrito", description = "Consulta y modifica el carrito activo del cliente autenticado.")
@SecurityRequirement(name = "bearerJwt")
public class CartController {

    private final CartService service;

    public CartController(CartService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Consultar carrito activo")
    @ApiResponse(responseCode = "200", description = "Carrito activo o representación vacía")
    public Cart get(@AuthenticationPrincipal Jwt jwt) {
        var cart = service.get(actorId(jwt));
        return new Cart(cart.cartId(), cart.state(), cart.items().stream().map(CartController::item).toList(),
                money(cart.totalCurrent()));
    }

    @PostMapping(path = "/items", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Agregar edición al carrito")
    @ApiResponse(responseCode = "200", description = "Carrito y artículo actualizados")
    @ApiResponse(responseCode = "400", description = "Solicitud inválida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ItemMutation addItem(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody AddItem request) {
        CartItemResult result = service.addItem(actorId(jwt), Long.parseLong(request.editionId()), request.quantity());
        return mutation(result);
    }

    @PutMapping(path = "/items/{cartItemId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Actualizar cantidad de un artículo")
    @ApiResponse(responseCode = "200", description = "Artículo actualizado")
    @ApiResponse(responseCode = "400", description = "Solicitud inválida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ItemMutation updateItem(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long cartItemId, @Valid @RequestBody Quantity request) {
        return mutation(service.updateItem(actorId(jwt), cartItemId, request.quantity()));
    }

    @DeleteMapping("/items/{cartItemId}")
    @Operation(summary = "Quitar artículo del carrito")
    @ApiResponse(responseCode = "204", description = "Artículo eliminado")
    @ApiResponse(responseCode = "404", description = "Artículo no encontrado en el carrito", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> removeItem(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long cartItemId) {
        service.removeItem(actorId(jwt), cartItemId);
        return ResponseEntity.noContent().build();
    }

    private static Item item(CartItem item) {
        return new Item(item.cartItemId(), item.editionId(), item.title(), item.authors(), item.sku(), item.coverUrl(),
                item.quantity(), money(item.currentPrice()), money(item.currentSubtotal()), item.available(),
                item.unavailabilityReason());
    }

    private static ItemMutation mutation(CartItemResult result) {
        return new ItemMutation(result.cartId(), result.cartItemId(), result.quantity());
    }

    private static String money(BigDecimal value) {
        return value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
    }

    private static long actorId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
