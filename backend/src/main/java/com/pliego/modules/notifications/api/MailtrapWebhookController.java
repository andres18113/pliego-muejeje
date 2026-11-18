package com.pliego.modules.notifications.api;

import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.HttpServletRequest;
import com.pliego.foundation.web.ProblemDetailFactory;
import com.pliego.modules.notifications.application.MailEventService;
import com.pliego.modules.notifications.provider.MailtrapWebhook;

@RestController
public class MailtrapWebhookController {
 private final MailtrapWebhook webhook;
 private final MailEventService service;
 private final ProblemDetailFactory problems;
 public MailtrapWebhookController(MailtrapWebhook webhook,MailEventService service,ProblemDetailFactory problems) {
  this.webhook=webhook;this.service=service;this.problems=problems;
 }
 @PostMapping(path="/api/v1/webhooks/mailtrap",consumes="application/json")
 @Operation(summary="Recibir resultados de correo",description="Requiere firma Mailtrap-Signature sobre el cuerpo crudo; desactivado sin secreto.",security={})
 public ResponseEntity<?> receive(HttpServletRequest request) throws IOException {
  if(!webhook.enabled())return error(request,HttpStatus.NOT_FOUND,"NOT_FOUND","Recurso no encontrado","El recurso solicitado no está disponible.");
  byte[] body=request.getInputStream().readNBytes(1_048_577);
  if(body.length>1_048_576)return error(request,HttpStatus.PAYLOAD_TOO_LARGE,"MAIL_WEBHOOK_TOO_LARGE","Solicitud demasiado grande","El lote de eventos supera el tamaño permitido.");
  if(!webhook.authentic(body,request.getHeader("Mailtrap-Signature")))return error(request,HttpStatus.UNAUTHORIZED,"MAIL_WEBHOOK_INVALID_SIGNATURE","Firma inválida","No se pudo autenticar el webhook.");
  try {service.record(webhook.parse(body));}
  catch(IllegalArgumentException e) {return error(request,HttpStatus.BAD_REQUEST,"MAIL_WEBHOOK_INVALID_PAYLOAD","Datos inválidos","El lote de eventos no es válido.");}
  catch(MailEventService.ConflictingEventException e) {return error(request,HttpStatus.CONFLICT,"MAIL_WEBHOOK_EVENT_CONFLICT","Evento incompatible","El identificador del evento ya tiene otros datos.");}
  return ResponseEntity.ok().build();
 }
 private ResponseEntity<ProblemDetail> error(HttpServletRequest request,HttpStatus status,String code,String title,String detail) {
  return ResponseEntity.status(status).body(problems.create(code,title,status,detail,request));
 }
}
