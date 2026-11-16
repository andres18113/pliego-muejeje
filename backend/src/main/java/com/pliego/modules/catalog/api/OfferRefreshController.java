package com.pliego.modules.catalog.api;

import com.pliego.modules.catalog.application.OfferLifecycleService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(path = "/api/v1/catalog", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Catálogo público", description = "Navegación de categorías y búsqueda/consulta de ediciones públicas.")
public class OfferRefreshController {
    private final OfferLifecycleService service;

    public OfferRefreshController(OfferLifecycleService service) { this.service = service; }

    @GetMapping("/offer-refresh")
    @Operation(operationId = "getOfferRefreshClock", summary = "Consultar la próxima actualización de ofertas",
            description = "Proyección pública sin caché con hora de PostgreSQL, próximo inicio o fin estrictamente futuro de una oferta activa y plazo de revalidación. El límite es global y conservador: puede incluir ofertas de ediciones ocultas y solo expone su hora agregada. Consultar antes de leer el contenido; el cliente relee el catálogo al alcanzar el plazo y nunca calcula precios, descuentos ni vigencia.")
    @ApiResponse(responseCode = "200", description = "Reloj y próxima transición pública")
    public ResponseEntity<OfferRefreshResponse> clock() {
        var clock = service.clock();
        return ResponseEntity.ok().header("Cache-Control", "no-store")
                .body(new OfferRefreshResponse(clock.serverTime(), clock.nextTransitionAt(), clock.revalidateAfterSeconds()));
    }
}
