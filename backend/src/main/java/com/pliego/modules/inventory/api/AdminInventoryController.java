package com.pliego.modules.inventory.api;

import java.util.function.Function;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.PageResponse;
import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.inventory.api.AdminInventoryRequests.Adjustment;
import com.pliego.modules.inventory.api.AdminInventoryRequests.Entry;
import com.pliego.modules.inventory.api.AdminInventoryRequests.Minimum;
import com.pliego.modules.inventory.application.InventoryModels.InventoryItem;
import com.pliego.modules.inventory.application.InventoryModels.Movement;
import com.pliego.modules.inventory.application.InventoryModels.MovementSearch;
import com.pliego.modules.inventory.application.InventoryModels.Page;
import com.pliego.modules.inventory.application.InventoryModels.Search;
import com.pliego.modules.inventory.application.InventoryService;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

@Validated
@RestController
@RequestMapping(path = "/api/v1/admin/inventory", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Administración de inventario", description = "Consulta y administración de existencias.")
@SecurityRequirement(name = "bearerJwt")
public class AdminInventoryController {

    private static final String MOVEMENT_TYPE_PATTERN = "ENTRY|ADJUSTMENT_IN|ADJUSTMENT_OUT|SALE|CANCELLATION";
    private final InventoryService service;

    public AdminInventoryController(InventoryService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Buscar inventario")
    @ApiResponse(responseCode = "200", description = "Página de inventario")
    @ApiResponse(responseCode = "400", description = "Filtros inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public PageResponse<AdminInventoryResponses.Item> search(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Positive Long editionId,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String sku,
            @RequestParam(defaultValue = "false") boolean lowStockOnly,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        Page<InventoryItem> result = service.search(actorId(jwt),
                new Search(editionId, title, sku, lowStockOnly, page, pageSize));
        return page(result, page, pageSize, row -> new AdminInventoryResponses.Item(row.editionId(), row.bookId(),
                row.title(), row.sku(), row.isbn13(), row.editionState(), row.stockActual(), row.stockMinimum(),
                row.lowStock(), row.updatedAt()));
    }

    @GetMapping("/{editionId}/movements")
    @Operation(summary = "Consultar movimientos de inventario")
    @ApiResponse(responseCode = "200", description = "Historial de movimientos")
    public PageResponse<AdminInventoryResponses.Movement> movements(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long editionId,
            @RequestParam(required = false) @Pattern(regexp = MOVEMENT_TYPE_PATTERN) String type,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        Page<Movement> result = service.movements(actorId(jwt), new MovementSearch(editionId, type, page, pageSize));
        return page(result, page, pageSize, row -> new AdminInventoryResponses.Movement(row.movementId(),
                row.editionId(), row.orderId(), row.actorUserId(), row.type(), row.quantity(), row.stockBefore(),
                row.stockAfter(), row.reason(), row.eventAt()));
    }

    @PostMapping(path = "/{editionId}/entries", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Registrar ingreso de inventario")
    @ApiResponse(responseCode = "201", description = "Ingreso registrado")
    public ResponseEntity<AdminInventoryResponses.MovementCreated> entry(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long editionId, @Valid @RequestBody Entry request) {
        var result = service.entry(actorId(jwt), editionId,
                new com.pliego.modules.inventory.application.InventoryModels.Entry(request.quantity(), request.reason()));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new AdminInventoryResponses.MovementCreated(result.movementId(), result.stockBefore(), result.stockAfter()));
    }

    @PostMapping(path = "/{editionId}/adjustments", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Ajustar existencias")
    @ApiResponse(responseCode = "201", description = "Ajuste registrado")
    public ResponseEntity<AdminInventoryResponses.MovementCreated> adjust(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive long editionId, @Valid @RequestBody Adjustment request) {
        var result = service.adjust(actorId(jwt), editionId,
                new com.pliego.modules.inventory.application.InventoryModels.Adjustment(request.type(),
                        request.quantity(), request.reason()));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new AdminInventoryResponses.MovementCreated(result.movementId(), result.stockBefore(), result.stockAfter()));
    }

    @PutMapping(path = "/{editionId}/minimum", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Actualizar mínimo de existencias")
    @ApiResponse(responseCode = "204", description = "Mínimo actualizado")
    public ResponseEntity<Void> setMinimum(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long editionId,
            @Valid @RequestBody Minimum request) {
        service.setMinimum(actorId(jwt), editionId, request.stockMinimum());
        return ResponseEntity.noContent().build();
    }

    private static long actorId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }

    private static <T, R> PageResponse<R> page(Page<T> page, int pageNumber, int pageSize,
            Function<T, R> mapper) {
        return new PageResponse<>(page.items().stream().map(mapper).toList(), pageNumber, pageSize,
                Long.toString(page.totalCount()));
    }
}
