package com.pliego.modules.identity.api;

import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.identity.application.EmailChangeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(path = "/api/v1", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Cambio de correo", description = "Confirmación y recuperación del cambio de correo.")
public class EmailChangeController {
    private final EmailChangeService changes;

    public EmailChangeController(EmailChangeService changes) {
        this.changes = changes;
    }

    @PostMapping("/me/email-change/resend")
    @SecurityRequirement(name = "bearerJwt")
    @Operation(operationId = "resendEmailChange", summary = "Reenviar la confirmación del correo pendiente",
            description = "Envía un nuevo enlace al correo pendiente e invalida el enlace de confirmación anterior. Conserva el vencimiento original de la solicitud. Hasta cinco reenvíos por hora y uno por minuto.")
    @ApiResponse(responseCode = "202", description = "Confirmación encolada", content = @Content)
    @ApiResponse(responseCode = "401", description = "Sesión inválida", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "404", description = "EMAIL_CHANGE_NOT_PENDING: no hay un cambio vigente", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "429", description = "EMAIL_CHANGE_RATE_LIMITED: espera antes de volver a pedir un enlace", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> resend(@AuthenticationPrincipal Jwt jwt) {
        changes.resend(Long.parseLong(jwt.getSubject()));
        return ResponseEntity.accepted().build();
    }

    @DeleteMapping("/me/email-change")
    @SecurityRequirement(name = "bearerJwt")
    @Operation(operationId = "cancelPendingEmailChange", summary = "Cancelar mi cambio de correo pendiente",
            description = "Operación idempotente. Conserva el correo actual y sus sesiones.")
    @ApiResponse(responseCode = "204", description = "No queda un cambio pendiente", content = @Content)
    @ApiResponse(responseCode = "401", description = "Sesión inválida", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> cancelPending(@AuthenticationPrincipal Jwt jwt) {
        changes.cancelForUser(Long.parseLong(jwt.getSubject()));
        return ResponseEntity.noContent().build();
    }

    @PostMapping(path = "/auth/email-change/confirm", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(operationId = "confirmEmailChange", summary = "Confirmar el nuevo correo",
            description = "Enlace público de un solo uso, válido durante 24 horas. Promueve el correo y lo verifica, limpia el bloqueo de entrega de la cuenta y revoca todas las sesiones de refresco. Los access tokens existentes conservan su expiración máxima de 30 minutos.")
    @ApiResponse(responseCode = "200", description = "Correo confirmado", content = @Content(schema = @Schema(implementation = ConfirmedResponse.class)))
    @ApiResponse(responseCode = "400", description = "EMAIL_CHANGE_TOKEN_INVALID: enlace inválido", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "409", description = "P1101: otra cuenta ya usa ese correo", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "410", description = "EMAIL_CHANGE_TOKEN_EXPIRED, EMAIL_CHANGE_TOKEN_USED, EMAIL_CHANGE_TOKEN_SUPERSEDED o EMAIL_CHANGE_CANCELLED", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    public ConfirmedResponse confirm(@RequestBody TokenRequest request) {
        return new ConfirmedResponse(changes.confirm(request.token()));
    }

    @PostMapping(path = "/auth/email-change/cancel", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(operationId = "cancelEmailChangeByToken", summary = "Cancelar el cambio desde el correo actual",
            description = "Enlace público de recuperación. Cancelar de nuevo tiene éxito. Si el cambio ya se confirmó devuelve EMAIL_CHANGE_ALREADY_CONFIRMED para continuar desde Ayuda.")
    @ApiResponse(responseCode = "200", description = "Cambio cancelado o ya cancelado", content = @Content)
    @ApiResponse(responseCode = "400", description = "EMAIL_CHANGE_TOKEN_INVALID: enlace inválido", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "410", description = "EMAIL_CHANGE_ALREADY_CONFIRMED, EMAIL_CHANGE_TOKEN_EXPIRED o EMAIL_CHANGE_TOKEN_SUPERSEDED", content = @Content(schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<Void> cancelByToken(@RequestBody TokenRequest request) {
        changes.cancelWithToken(request.token());
        return ResponseEntity.ok().build();
    }

    @Schema(name = "EmailChangeTokenRequest")
    public record TokenRequest(@Schema(requiredMode = Schema.RequiredMode.REQUIRED, minLength = 43, maxLength = 43,
            description = "Credencial recibida en el fragmento del enlace; no se incluye en la URL de la API.") String token) {
        @Override public String toString() { return "EmailChangeTokenRequest[REDACTED]"; }
    }

    @Schema(name = "EmailChangeConfirmedResponse")
    public record ConfirmedResponse(@Schema(requiredMode = Schema.RequiredMode.REQUIRED,
            example = "nuevo@example.com") String email) {}
}
