package com.pliego.modules.identity.api;

import org.springframework.http.HttpStatus;
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
 public EmailActionController(EmailActionService actions) {this.actions=actions;}
 @PostMapping(path="/resend-verification",consumes=MediaType.APPLICATION_JSON_VALUE)
 @Operation(summary="Solicitar otro enlace de verificación",description="Respuesta neutra. Un minuto entre emisiones, hasta cinco solicitudes por correo y veinte por IP por hora.")
 @ApiResponse(responseCode="202",description="Solicitud recibida",content=@Content(schema=@Schema(implementation=AcceptedResponse.class)))
 @ApiResponse(responseCode="400",description="Datos inválidos",content=@Content(schema=@Schema(implementation=ProblemResponse.class)))
 public ResponseEntity<AcceptedResponse> resend(@Valid @RequestBody EmailRequest request,HttpServletRequest servlet) {
  actions.request(request.email(),"VERIFY_EMAIL",servlet.getRemoteAddr());return accepted();
 }
 @PostMapping(path="/forgot-password",consumes=MediaType.APPLICATION_JSON_VALUE)
 @Operation(summary="Solicitar recuperación de contraseña",description="Respuesta idéntica para cuentas existentes, desconocidas, bloqueadas o limitadas. Enlace de uso único durante 15 minutos.")
 @ApiResponse(responseCode="202",description="Solicitud recibida",content=@Content(schema=@Schema(implementation=AcceptedResponse.class)))
 @ApiResponse(responseCode="400",description="Datos inválidos",content=@Content(schema=@Schema(implementation=ProblemResponse.class)))
 public ResponseEntity<AcceptedResponse> forgot(@Valid @RequestBody EmailRequest request,HttpServletRequest servlet) {
  actions.request(request.email(),"RESET_PASSWORD",servlet.getRemoteAddr());return accepted();
 }
 @PostMapping(path="/verify-email",consumes=MediaType.APPLICATION_JSON_VALUE)
 @Operation(summary="Verificar correo",description="Consume un token de uso único que vence a las 24 horas. No inicia sesión automáticamente.")
 @ApiResponse(responseCode="204",description="Correo verificado",content=@Content)
 @ApiResponse(responseCode="400",description="Enlace inválido, vencido o utilizado",content=@Content(schema=@Schema(implementation=ProblemResponse.class)))
 public ResponseEntity<Void> verify(@Valid @RequestBody TokenRequest request) {
  if(!actions.verify(request.token()))throw new InvalidEmailActionException();return ResponseEntity.noContent().build();
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
