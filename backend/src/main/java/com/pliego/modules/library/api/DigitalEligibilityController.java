package com.pliego.modules.library.api;

import java.util.List;
import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.library.application.DigitalEligibility;
import com.pliego.modules.library.application.DigitalEligibilityService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/me/digital-eligibility")
@SecurityRequirement(name = "bearerJwt")
@Tag(name = "Mi biblioteca", description = "Propiedad y elegibilidad de ediciones digitales.")
public class DigitalEligibilityController {
    private final DigitalEligibilityService service;

    public DigitalEligibilityController(DigitalEligibilityService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(operationId = "getDigitalEligibility", summary = "Consultar elegibilidad de compra digital",
            description = "Entre 1 y 50 ediciones por petición. Devuelve cada ID una vez, en orden de primera aparición. Ediciones inexistentes, físicas o inactivas no son comprables. Solo consulta datos del cliente autenticado; la confirmación vuelve a validar.")
    @ApiResponse(responseCode = "200", description = "Elegibilidad de cada edición solicitada", content = @Content(array = @ArraySchema(schema = @Schema(implementation = DigitalEligibility.class))))
    @ApiResponse(responseCode = "400", description = "Lista de ediciones inválida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "401", description = "Autenticación requerida", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public List<DigitalEligibility> get(@AuthenticationPrincipal Jwt jwt,
            @Parameter(required = true, description = "Entre 1 y 50 identificadores de edición positivos.")
            @RequestParam(required = false)
            @NotEmpty(message = "Debes indicar al menos una edición.")
            @Size(max = 50, message = "Puedes consultar hasta cincuenta ediciones.")
            List<@Positive(message = "El identificador de edición debe ser positivo.") Long> editionIds) {
        return service.get(Long.parseLong(jwt.getSubject()), editionIds);
    }
}
