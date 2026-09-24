package com.pliego.modules.customer.api;

import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.PageResponse;
import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.customer.api.AdminCustomerRequests.Status;
import com.pliego.modules.customer.application.AdminCustomerModels.CustomerSummary;
import com.pliego.modules.customer.application.AdminCustomerModels.Page;
import com.pliego.modules.customer.application.AdminCustomerModels.Search;
import com.pliego.modules.customer.application.AdminCustomerService;

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
@RequestMapping(path = "/api/v1/admin/customers", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Administración de clientes", description = "Búsqueda y activación de cuentas de cliente.")
@SecurityRequirement(name = "bearerJwt")
public class AdminCustomerController {
    private static final String STATE_PATTERN = "ACTIVE|BLOCKED";
    private final AdminCustomerService service;

    public AdminCustomerController(AdminCustomerService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Buscar clientes")
    @ApiResponse(responseCode = "200", description = "Página de clientes")
    @ApiResponse(responseCode = "400", description = "Filtros inválidos", content = @Content(
            mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public PageResponse<AdminCustomerResponses.CustomerSummary> search(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) @Pattern(regexp = STATE_PATTERN,
                    message = "El estado debe ser ACTIVE o BLOCKED.") String state,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(50) int pageSize) {
        Page result = service.search(actorUserId(jwt), new Search(query, state, page, pageSize));
        List<AdminCustomerResponses.CustomerSummary> items = result.items().stream()
                .map(row -> new AdminCustomerResponses.CustomerSummary(row.customerId(), row.email(),
                        row.firstNames(), row.lastNames(), row.phone(), row.state(), row.createdAt()))
                .toList();
        return new PageResponse<>(items, page, pageSize, Long.toString(result.totalCount()));
    }

    @PutMapping(path = "/{customerId}/status", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Cambiar el estado de un cliente")
    @ApiResponse(responseCode = "204", description = "Estado actualizado")
    @ApiResponse(responseCode = "404", description = "Cliente no encontrado", content = @Content(
            mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> setStatus(@AuthenticationPrincipal Jwt jwt,
            @PathVariable @Positive(message = "El identificador del cliente debe ser positivo.") long customerId,
            @Valid @RequestBody Status request) {
        service.setStatus(actorUserId(jwt), customerId, request.state());
        return ResponseEntity.noContent().build();
    }

    private static long actorUserId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
