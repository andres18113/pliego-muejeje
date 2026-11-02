package com.pliego.modules.catalog.api;

import java.math.BigDecimal;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import com.pliego.modules.catalog.application.EditionOfferCommand;
import com.pliego.modules.catalog.application.EditionOfferService;
import com.pliego.modules.catalog.application.EditionOfferPrecondition;
import com.pliego.foundation.web.ProblemResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

@Validated
@RestController
@RequestMapping(path = "/api/v1/admin/editions/{editionId}/offer", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Administración de catálogo")
@SecurityRequirement(name = "bearerJwt")
public class EditionOfferController {
    private final EditionOfferService service;
    public EditionOfferController(EditionOfferService service) { this.service = service; }

    @PutMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Establecer una oferta de edición", description = "Reemplaza la única oferta de la edición. Con If-None-Match: *, X-Expected-Base-Price y X-Expected-Stock crea solo si no existe ninguna fila y la base/stock siguen iguales; NONE representa stock digital. Las tres cabeceras se requieren juntas. PostgreSQL valida bajo bloqueo; precondición fallida devuelve P1001/400.")
    @ApiResponse(responseCode = "204", description = "Oferta guardada")
    @ApiResponse(responseCode = "400", description = "Precio o fechas inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "404", description = "Edición no encontrada", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> set(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long editionId,
            @RequestBody @Valid EditionOfferRequest request,
            @RequestHeader(name = "If-None-Match", required = false)
            @jakarta.validation.constraints.Pattern(regexp = "\\*", message = "La condición de creación debe ser *.") String ifNoneMatch,
            @RequestHeader(name = "X-Expected-Base-Price", required = false)
            @jakarta.validation.constraints.Pattern(regexp = "(?:0|[1-9][0-9]{0,8})\\.[0-9]{2}", message = "El precio base esperado debe tener dos decimales.") String expectedBase,
            @RequestHeader(name = "X-Expected-Stock", required = false)
            @jakarta.validation.constraints.Pattern(regexp = "NONE|0|[1-9][0-9]{0,9}", message = "El stock esperado debe ser un entero no negativo o NONE.") String expectedStock) {
        var command = new EditionOfferCommand(new BigDecimal(request.offerPrice()), request.startsAt(), request.endsAt(), request.offerCopy(), request.terms());
        if (ifNoneMatch != null || expectedBase != null || expectedStock != null) {
            service.createIfAbsent(Long.parseLong(jwt.getSubject()), editionId, command,
                    new EditionOfferPrecondition(ifNoneMatch, expectedBase == null ? null : new BigDecimal(expectedBase), expectedStock));
        } else {
            service.set(Long.parseLong(jwt.getSubject()), editionId, command);
        }
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping
    @Operation(summary = "Desactivar una oferta de edición", description = "Desactiva la oferta sin cambiar el precio base ni los importes históricos de pedidos.")
    @ApiResponse(responseCode = "204", description = "Oferta desactivada")
    @ApiResponse(responseCode = "404", description = "Edición no encontrada", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> clear(@AuthenticationPrincipal Jwt jwt, @PathVariable @Positive long editionId) {
        service.clear(Long.parseLong(jwt.getSubject()), editionId);
        return ResponseEntity.noContent().build();
    }
}
