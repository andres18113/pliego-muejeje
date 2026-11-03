package com.pliego.modules.realtime.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.pliego.foundation.web.ProblemDetailFactory;
import com.pliego.modules.identity.api.AuthSessionCookie;
import com.pliego.modules.realtime.application.RealtimeStreams;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;

@RestController
@io.swagger.v3.oas.annotations.tags.Tag(name="Realtime",description="Avisos privados de invalidación mediante SSE.")
@SecurityRequirement(name="authSessionCookie")
public class RealtimeController {
 private final RealtimeStreams streams;
 private final ProblemDetailFactory problems;
 public RealtimeController(RealtimeStreams streams,ProblemDetailFactory problems){this.streams=streams;this.problems=problems;}
 @GetMapping(path="/api/v1/auth/events",produces="text/event-stream")
 @Operation(operationId="streamResourceEvents",summary="Recibir avisos de actualización",
  description="SSE con cookie de sesión HttpOnly; CUSTOMER recibe sus recursos y ADMIN el ámbito administrativo. Sin tokens en URL. Eventos de invalidación: identity.correction.created/decided/withdrawn/acknowledged, order.changed, order.cancellation-window.expired, pickup.ready y library.changed. Datos: {resourceType,resourceId}, identificadores como cadenas. resync: {reason:replay-unavailable} obliga a releer recursos activos. Cursor id decimal global; Last-Event-ID permite repetir durante una hora. retry 3000ms, heartbeat cada 16s como máximo, conexión máxima 60s, cuatro por usuario. Reautentica al reconectar; cierre por revocación en el siguiente sondeo (2s).")
 @SecurityRequirement(name="authSessionCookie")
 @ApiResponse(responseCode="200",description="Flujo SSE; ver ADR0054 para recursos que invalidar",content=@Content(mediaType="text/event-stream",schema=@Schema(type="string")))
 @ApiResponse(responseCode="400",description="Cursor inválido")
 @ApiResponse(responseCode="401",description="Sesión ausente, inválida, revocada o vencida")
 @ApiResponse(responseCode="429",description="Límite de conexiones; Retry-After: 60")
 public ResponseEntity<?> events(@Parameter(hidden=true) @CookieValue(name=AuthSessionCookie.NAME,required=false)String cookie,
  @RequestHeader(name="Last-Event-ID",required=false)String lastEventId,HttpServletRequest request){
  Long cursor=null;
  if(lastEventId!=null){
   try{if(!lastEventId.matches("[0-9]{1,19}"))throw new NumberFormatException();cursor=Long.valueOf(lastEventId);}
   catch(NumberFormatException e){return problem(request,HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Datos inválidos","El identificador del último evento no es válido.");}
  }
  try{return ResponseEntity.ok().header("Cache-Control","no-cache").header("X-Accel-Buffering","no").body(streams.open(cookie,cursor));}
  catch(RealtimeStreams.OpenFailure e){
   if(e.limited())return ResponseEntity.status(429).contentType(org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON).header("Retry-After","60").body(problems.create("REALTIME_CONNECTION_LIMITED","Demasiadas conexiones",HttpStatus.TOO_MANY_REQUESTS,"Cierra alguna pestaña o espera un minuto antes de volver a intentarlo.",request));
   return problem(request,HttpStatus.UNAUTHORIZED,"AUTH_REQUIRED","Autenticación requerida","Debes iniciar sesión para recibir actualizaciones.");
  }
 }
 private ResponseEntity<?> problem(HttpServletRequest r,HttpStatus s,String code,String title,String detail){return ResponseEntity.status(s).contentType(org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON).body(problems.create(code,title,s,detail,r));}
}
