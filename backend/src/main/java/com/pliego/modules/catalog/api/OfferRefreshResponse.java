package com.pliego.modules.catalog.api;

import java.time.Instant;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "OfferRefreshResponse", description = "Reloj de PostgreSQL y próxima actualización temporal del catálogo; no determina precios ni vigencia en el cliente.")
public record OfferRefreshResponse(
        @Schema(description = "Hora de PostgreSQL usada para calcular esta proyección.", requiredMode = Schema.RequiredMode.REQUIRED)
        Instant serverTime,
        @Schema(description = "Próximo inicio o fin estrictamente futuro de una oferta activa. Es una proyección global conservadora que puede incluir ofertas de ediciones ocultas; no revela sus identificadores ni contenido. null cuando no queda ningún límite futuro. Al alcanzarlo se releen los recursos públicos activos.", nullable = true, requiredMode = Schema.RequiredMode.REQUIRED)
        Instant nextTransitionAt,
        @Schema(description = "Plazo máximo para volver a consultar este reloj y descubrir cambios administrativos.", minimum = "1", example = "60", requiredMode = Schema.RequiredMode.REQUIRED)
        int revalidateAfterSeconds) { }
