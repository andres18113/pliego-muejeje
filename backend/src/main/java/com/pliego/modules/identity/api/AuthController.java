package com.pliego.modules.identity.api;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.identity.application.AuthService;
import com.pliego.modules.identity.application.AuthService.LoginResult;
import com.pliego.modules.identity.gateway.RegistrationResult;
import com.pliego.modules.identity.application.RegistrationContinuationService;
import jakarta.servlet.http.HttpServletRequest;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@Validated
@RestController
@RequestMapping(path = "/api/v1/auth", produces = MediaType.APPLICATION_JSON_VALUE)
@Tag(name = "Authentication", description = "Registro público e inicio de sesión.")
public class AuthController {

    private final AuthService authService;
    private final AuthSessionCookie sessionCookie;

    private final RegistrationContinuationService continuation;
    private final RegistrationContinuationCookie continuationCookie;

    public AuthController(AuthService authService, AuthSessionCookie sessionCookie,
            RegistrationContinuationService continuation, RegistrationContinuationCookie continuationCookie) {
        this.continuation=continuation;
        this.continuationCookie=continuationCookie;
        this.authService = authService;
        this.sessionCookie = sessionCookie;
    }

    @PostMapping(path = "/register", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Registrar una cuenta CUSTOMER", description = "Aplica BCrypt y crea cuenta pendiente de verificación junto con el correo en outbox, en una única transacción. Establece una credencial HttpOnly independiente, válida como máximo 24 horas, para continuar en este navegador después de verificar; no concede acceso por sí sola.")
    @ApiResponse(responseCode = "201", description = "Cuenta de cliente creada", headers=@Header(name="Set-Cookie",description="Continuidad HttpOnly, Secure, SameSite=Strict, host-only; máximo 24 horas"), content = @Content(schema = @Schema(implementation = RegisterResponse.class)))
    @ApiResponse(responseCode = "400", description = "Datos inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "409", description = "Correo ya registrado", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<RegisterResponse> register(@Valid @RequestBody RegisterRequest request) {
        var registered = continuation.register(request.email(), request.password(), request.firstNames(),
                request.lastNames(), request.phone(), request.returnTo());
        RegistrationResult result = registered.registration();
        RegisterResponse response = new RegisterResponse(Long.toString(result.userId()),
                Long.toString(result.customerId()), result.state());
        return ResponseEntity.status(HttpStatus.CREATED)
                .header(HttpHeaders.SET_COOKIE, continuationCookie.issue(registered.secret(), registered.expiresAt())).body(response);
    }

    @PostMapping(path = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Iniciar sesión", description = "Emite un access token bearer HS256 válido durante 30 minutos y establece una cookie HttpOnly de sesión revocable, válida durante 30 días.")
    @ApiResponse(responseCode = "200", description = "Token de acceso emitido y sesión persistente establecida",
            headers = @Header(name = "Set-Cookie", description = "Cookie HttpOnly, Secure y SameSite=Strict; expira 30 días después del inicio de sesión.", schema = @Schema(type = "string")),
            content = @Content(schema = @Schema(implementation = LoginResponse.class)))
    @ApiResponse(responseCode = "400", description = "Datos inválidos", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "401", description = "Credenciales inválidas", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "403", description = "Correo pendiente de verificación (EMAIL_NOT_VERIFIED)", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "429", description = "Demasiados intentos (AUTH_LOGIN_RATE_LIMITED). Conserva las credenciales y reintenta después de la espera; no revela si la cuenta existe.",
            headers = @Header(name = "Retry-After", description = "Segundos hasta el próximo intento", schema = @Schema(type = "integer", minimum = "1", maximum = "3600")),
            content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request, HttpServletRequest servletRequest) {
        LoginResult result = continuation.login(request.email(), request.password(), servletRequest.getRemoteAddr());
        return loginResponse(result, true);
    }

    @PostMapping(path = "/refresh")
    @Operation(operationId = "refreshSession", summary = "Restaurar o renovar la sesión", description = "Rota la credencial persistente HttpOnly y emite un access token nuevo. Si se pierde la respuesta, repetir con la cookie anterior durante 5 minutos devuelve la misma rotación. La sesión tiene una expiración absoluta de 30 días desde el inicio de sesión.")
    @ApiResponse(responseCode = "200", description = "Sesión restaurada",
            headers = @Header(name = "Set-Cookie", description = "Cookie HttpOnly renovada; conserva la expiración absoluta de la sesión.", schema = @Schema(type = "string")),
            content = @Content(schema = @Schema(implementation = LoginResponse.class)))
    @ApiResponse(responseCode = "204", description = "No existe una sesión válida; se elimina la cookie",
            headers = @Header(name = "Set-Cookie", description = "Cookie eliminada.", schema = @Schema(type = "string")),
            content = @Content)
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @SecurityRequirement(name = "authSessionCookie")
    @Parameter(name = "X-PLIEGO-SESSION-REQUEST", in = ParameterIn.HEADER, required = true,
            description = "Marcador requerido para autorizar la petición de sesión desde el cliente PLIEGO.")
    public ResponseEntity<LoginResponse> refresh(
            @Parameter(hidden = true)
            @CookieValue(name = AuthSessionCookie.NAME, required = false) String refreshToken) {
        LoginResult result = authService.refresh(refreshToken);
        if (result == null) {
            return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, sessionCookie.clear()).build();
        }
        return loginResponse(result, false);
    }

    @PostMapping(path="/registration-session")
    @Operation(operationId="registrationSession",summary="Continuar el registro verificado",
            description="La cookie de continuidad no concede acceso. Devuelve 202 mientras falta verificar; una cuenta verificada consume la credencial y crea una única familia de sesión. Una repetición durante cinco minutos devuelve REFRESH_REQUIRED: renovar mediante /refresh, reintentando brevemente si otra pestaña aún no recibió la cookie. Cuotas: 1200 intentos por IP/hora y 600 por credencial/hora. Si se agota una cuota, devuelve 202 con RETRY_LATER y Retry-After en segundos, sin consumir la continuidad ni enviar Set-Cookie; reintentar con la misma cookie después de la espera indicada.")
    @ApiResponse(responseCode="200",description="Sesión creada; destino local validado",headers=@Header(name="Set-Cookie",description="Sesión HttpOnly y eliminación de la continuidad"),content=@Content(schema=@Schema(implementation=RegistrationSessionResponse.class)))
    @ApiResponse(responseCode="202",description="Verificación pendiente, sesión creada por otra petición o cuota agotada; en REFRESH_REQUIRED llamar a refresh y en RETRY_LATER conservar la cookie y reintentar después, sin Set-Cookie",headers=@Header(name="Retry-After",description="Segundos hasta el próximo intento cuando el estado es RETRY_LATER",schema=@Schema(type="integer",minimum="1")),content=@Content(schema=@Schema(implementation=RegistrationSessionState.class)))
    @ApiResponse(responseCode="204",description="Continuidad ausente, inválida, vencida o consumida fuera de la ventana; cookie eliminada",content=@Content)
    @ApiResponse(responseCode="403",description="Marcador de sesión requerido",content=@Content(schema=@Schema(implementation=ProblemResponse.class)))
    @SecurityRequirement(name="registrationContinuationCookie")
    @Parameter(name="X-PLIEGO-SESSION-REQUEST",in=ParameterIn.HEADER,required=true,description="Valor requerido: 1")
    public ResponseEntity<?> registrationSession(
            @Parameter(hidden=true) @CookieValue(name=RegistrationContinuationCookie.NAME,required=false) String secret,
            HttpServletRequest request) {
        var result=continuation.exchange(secret,request.getRemoteAddr());
        if(result==null)return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE,continuationCookie.clear()).build();
        if(result.session()==null) {
            var response=ResponseEntity.accepted();
            if(result.retryAfterSeconds()!=null)response.header(HttpHeaders.RETRY_AFTER,result.retryAfterSeconds().toString());
            return response.body(new RegistrationSessionState(result.state()));
        }
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE,
                sessionCookie.issue(result.session().refreshToken(),result.session().sessionExpiresAt()),continuationCookie.clear())
                .body(RegistrationSessionResponse.from(result.session(),result.returnTo()));
    }

    @PostMapping(path = "/logout")
    @Operation(operationId = "logoutSession", summary = "Cerrar sesión", description = "Revoca la sesión persistente y elimina su cookie HttpOnly. La operación es idempotente.")
    @ApiResponse(responseCode = "204", description = "Sesión revocada y cookie eliminada",
            headers = @Header(name = "Set-Cookie", description = "Cookie eliminada.", schema = @Schema(type = "string")),
            content = @Content)
    @ApiResponse(responseCode = "500", description = "Error interno", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ProblemResponse.class)))
    @SecurityRequirement(name = "authSessionCookie")
    @Parameter(name = "X-PLIEGO-SESSION-REQUEST", in = ParameterIn.HEADER, required = true,
            description = "Marcador requerido para autorizar la petición de sesión desde el cliente PLIEGO.")
    public ResponseEntity<Void> logout(
            @Parameter(hidden = true)
            @CookieValue(name = AuthSessionCookie.NAME, required = false) String refreshToken,
            @Parameter(hidden=true) @CookieValue(name=RegistrationContinuationCookie.NAME,required=false) String registrationSecret) {
        continuation.logout(refreshToken,registrationSecret);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, sessionCookie.clear(),continuationCookie.clear()).build();
    }

    private ResponseEntity<LoginResponse> loginResponse(LoginResult result, boolean clearContinuation) {
        LoginResponse response = new LoginResponse(result.accessToken(), "Bearer",
                Math.toIntExact(result.expiresInSeconds()),
                new LoginResponse.AuthenticatedUser(Long.toString(result.userId()), result.email(), result.role()));
        var builder = ResponseEntity.ok().header(HttpHeaders.SET_COOKIE,
                sessionCookie.issue(result.refreshToken(), result.sessionExpiresAt()));
        if (clearContinuation) builder.header(HttpHeaders.SET_COOKIE, continuationCookie.clear());
        return builder.body(response);
    }
}
