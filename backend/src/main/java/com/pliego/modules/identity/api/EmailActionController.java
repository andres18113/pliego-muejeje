package com.pliego.modules.identity.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import com.pliego.modules.identity.application.RegistrationContinuationService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.pliego.foundation.web.ProblemResponse;
import com.pliego.modules.identity.application.EmailActionService;
import com.pliego.modules.identity.api.EmailActionRequests.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

@RestController
@RequestMapping(path="/api/v1/auth",produces=MediaType.APPLICATION_JSON_VALUE)
@Tag(name="Authentication")
public class EmailActionController {
 private final EmailActionService actions;
 private final RegistrationContinuationService continuation;
 private final AuthSessionCookie sessionCookie;
 private final RegistrationContinuationCookie continuationCookie;
 public EmailActionController(EmailActionService actions,RegistrationContinuationService continuation,AuthSessionCookie sessionCookie,RegistrationContinuationCookie continuationCookie) {
  this.actions=actions;this.continuation=continuation;this.sessionCookie=sessionCookie;this.continuationCookie=continuationCookie;
 }
 @PostMapping(path="/resend-verification",consumes=MediaType.APPLICATION_JSON_VALUE)
 @Operation(summary="Solicitar otro enlace de verificación",description="Respuesta neutra. Un minuto entre emisiones, hasta cinco solicitudes por correo y veinte por IP por hora.")
 @ApiResponse(responseCode="202",description="Solicitud recibida",content=@Content(schema=@Schema(implementation=AcceptedResponse.class)))
 @ApiResponse(responseCode="400",description="Datos inválidos",content=@Content(schema=@Schema(implementation=ProblemResponse.class)))
 public ResponseEntity<AcceptedResponse> resend(@Valid @RequestBody EmailRequest request,HttpServletRequest servlet) {
  actions.request(request.email(),"VERIFY_EMAIL",servlet.getRemoteAddr(),request.returnTo());return accepted();
 }
 @PostMapping(path="/forgot-password",consumes=MediaType.APPLICATION_JSON_VALUE)
 @Operation(summary="Solicitar recuperación de contraseña",description="Respuesta idéntica para cuentas existentes, desconocidas, bloqueadas o limitadas. Enlace de uso único durante 15 minutos.")
 @ApiResponse(responseCode="202",description="Solicitud recibida",content=@Content(schema=@Schema(implementation=AcceptedResponse.class)))
 @ApiResponse(responseCode="400",description="Datos inválidos",content=@Content(schema=@Schema(implementation=ProblemResponse.class)))
 public ResponseEntity<AcceptedResponse> forgot(@Valid @RequestBody EmailRequest request,HttpServletRequest servlet) {
  actions.request(request.email(),"RESET_PASSWORD",servlet.getRemoteAddr(),request.returnTo());return accepted();
 }
 @PostMapping(path="/verify-email",consumes=MediaType.APPLICATION_JSON_VALUE)
 @Operation(summary="Verificar correo",description="Consume un token de uso único que vence a las 24 horas. Con la continuidad válida del mismo usuario, verifica y crea una sesión en una sola transacción; requiere X-PLIEGO-SESSION-REQUEST: 1 cuando existe esa cookie. Desde otro navegador solo verifica.")
 @io.swagger.v3.oas.annotations.Parameter(name="X-PLIEGO-SESSION-REQUEST",in=io.swagger.v3.oas.annotations.enums.ParameterIn.HEADER,description="Valor 1 requerido si se envía la cookie pliego_registration")
 @ApiResponse(responseCode="200",description="Correo verificado y sesión creada en el navegador de registro",headers=@io.swagger.v3.oas.annotations.headers.Header(name="Set-Cookie",description="Sesión y eliminación de continuidad"),content=@Content(schema=@Schema(implementation=RegistrationSessionResponse.class)))
 @ApiResponse(responseCode="204",description="Correo verificado sin sesión, incluso si se agota la cuota de intercambio; no envía Set-Cookie y conserva la continuidad para reintentar en registration-session",content=@Content)
 @ApiResponse(responseCode="400",description="Enlace inválido, vencido o utilizado",content=@Content(schema=@Schema(implementation=ProblemResponse.class)))
 public ResponseEntity<?> verify(@Valid @RequestBody TokenRequest request,
   @io.swagger.v3.oas.annotations.Parameter(hidden=true) @CookieValue(name=RegistrationContinuationCookie.NAME,required=false) String secret,
   HttpServletRequest servlet) {
  var result=continuation.verify(request.token(),secret,servlet.getRemoteAddr());
  if(result==null)throw new InvalidEmailActionException();
  if(result.session()==null)return ResponseEntity.noContent().build();
  return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE,
    sessionCookie.issue(result.session().refreshToken(),result.session().sessionExpiresAt()),continuationCookie.clear())
    .body(RegistrationSessionResponse.from(result.session(),result.returnTo()));
 }
 @PostMapping(path="/reset-password",consumes=MediaType.APPLICATION_JSON_VALUE)
 @Operation(summary="Restablecer contraseña",description="Consume token de recuperación, aplica BCrypt y revoca todas las sesiones de refresco. Los access tokens anteriores conservan su expiración máxima de 30 minutos.")
 @ApiResponse(responseCode="204",description="Contraseña restablecida",content=@Content)
 @ApiResponse(responseCode="400",description="Enlace o contraseña inválidos",content=@Content(schema=@Schema(implementation=ProblemResponse.class)))
 public ResponseEntity<Void> reset(@Valid @RequestBody ResetRequest request) {
  if(!actions.reset(request.token(),request.password()))throw new InvalidEmailActionException();return ResponseEntity.noContent().build();
 }
 private static ResponseEntity<AcceptedResponse> accepted() {
  return ResponseEntity.status(HttpStatus.ACCEPTED).body(new AcceptedResponse("Si la cuenta cumple los requisitos, recibirás un correo con los pasos a seguir."));
 }
}
