package com.pliego.modules.identity.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.modules.identity.application.AuthService;
import com.pliego.modules.identity.application.AuthService.LoginResult;
import com.pliego.modules.identity.gateway.RegistrationResult;
import com.pliego.foundation.web.ProblemResponse;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@Validated
@RestController
@RequestMapping(path = "/api/v1/auth", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Authentication", description = "Registro público e inicio de sesión.")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping(path = "/register", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Registrar una cuenta CUSTOMER", description = "Aplica BCrypt a la contraseña antes de llamar al procedimiento aprobado de PostgreSQL.")
    @ApiResponse(responseCode = "201", description = "Cuenta de cliente creada", content = @Content(schema = @Schema(implementation = RegisterResponse.class)))
    @ApiResponse(responseCode = "400", description = "Datos inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "409", description = "Correo ya registrado", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<RegisterResponse> register(@Valid @RequestBody RegisterRequest request) {
        RegistrationResult result = authService.register(request.email(), request.password(), request.firstNames(),
                request.lastNames(), request.phone());
        RegisterResponse response = new RegisterResponse(Long.toString(result.userId()),
                Long.toString(result.customerId()), result.state());
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @PostMapping(path = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Iniciar sesión", description = "Devuelve un token bearer HS256 sin estado, válido durante 30 minutos.")
    @ApiResponse(responseCode = "200", description = "Token de acceso emitido", content = @Content(schema = @Schema(implementation = LoginResponse.class)))
    @ApiResponse(responseCode = "400", description = "Datos inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "401", description = "Credenciales inválidas", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public LoginResponse login(@Valid @RequestBody LoginRequest request) {
        LoginResult result = authService.login(request.email(), request.password());
        return new LoginResponse(result.accessToken(), "Bearer", Math.toIntExact(result.expiresInSeconds()),
                new LoginResponse.AuthenticatedUser(Long.toString(result.userId()), result.email(), result.role()));
    }
}
