package com.pliego.modules.notifications.provider;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.JsonNode;
import com.pliego.modules.notifications.application.MailProviderEvent;
import com.pliego.modules.notifications.application.MailtrapWebhookProperties;

@Component
public final class MailtrapWebhook {
 private final MailtrapWebhookProperties properties;
 private final ObjectMapper json;
 public MailtrapWebhook(MailtrapWebhookProperties properties,ObjectMapper json) {this.properties=properties;this.json=json;}
 public boolean enabled() {return properties.enabled();}
 public boolean authentic(byte[] body,String signature) {
  if(!enabled()||signature==null||!signature.matches("[0-9a-fA-F]{64}"))return false;
  try {
   var mac=Mac.getInstance("HmacSHA256");
   mac.init(new SecretKeySpec(properties.secret().getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
   return MessageDigest.isEqual(mac.doFinal(body),HexFormat.of().parseHex(signature));
  } catch(GeneralSecurityException e) {throw new IllegalStateException("No se pudo validar el webhook.",e);}
 }
 public List<MailProviderEvent> parse(byte[] body) {
  try {
   var root=json.readTree(body);
   var events=root.isArray()?root:root.path("events");
   if(!events.isArray()||events.size()>500)throw new IllegalArgumentException();
   List<MailProviderEvent> result=new ArrayList<>();
   for(var event:events) {
    String type=event.path("event").asText("");
    if(!"transactional".equals(event.path("sending_stream").asText()))continue;
    String status=switch(type) {
     case "delivery" -> "DELIVERED";
     case "bounce" -> "BOUNCED";
     case "soft bounce" -> "SOFT_BOUNCE";
     case "reject" -> "REJECTED";
     case "suspension" -> "SUSPENDED";
     default -> null;
    };
    if(status==null)continue;
    String reason="BOUNCED".equals(status)?"HARD_BOUNCE":null;
    String providerReason=event.path("reason").asText("").toLowerCase(Locale.ROOT);
    if(("REJECTED".equals(status)||"SUSPENDED".equals(status))&&providerReason.contains("suppression")) {
     status="SUPPRESSED";reason="SUPPRESSED";
    }
    var time=event.path("timestamp");
    if(!time.isIntegralNumber()||!time.canConvertToLong()||time.asLong()<0)throw new IllegalArgumentException();
    result.add(new MailProviderEvent(id(event,"event_id"),id(event,"message_id"),status,reason,Instant.ofEpochSecond(time.asLong())));
   }
   return List.copyOf(result);
  } catch(RuntimeException e) {throw new IllegalArgumentException("El lote de eventos no es válido.");}
 }
 private static String id(JsonNode event,String name) {
  var value=event.path(name);
  if(!value.isTextual()||!value.asText().matches("[A-Za-z0-9._:-]{1,128}"))throw new IllegalArgumentException();
  return value.asText();
 }
}
