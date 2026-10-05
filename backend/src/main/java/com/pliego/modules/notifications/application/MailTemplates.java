package com.pliego.modules.notifications.application;

import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.pliego.modules.identity.application.EmailActionTokens;

@Component
public final class MailTemplates {
 private final MailProperties properties;
 private final EmailActionTokens tokens;
 public MailTemplates(MailProperties properties,EmailActionTokens tokens,ObjectMapper mapper) {
  this.properties=properties; this.tokens=tokens;
 }
 public MailMessage render(String type,JsonNode data) {
  String base=properties.publicUrl().toString().replaceAll("/+$","");
  String subject; String content; String url; String label;
  if("VERIFY_EMAIL".equals(type)||"RESET_PASSWORD".equals(type)) {
   boolean verify="VERIFY_EMAIL".equals(type);
   subject=verify?"Verifica tu correo en PLIEGO":"Restablece tu contraseña en PLIEGO";
   label=verify?"Verificar correo":"Restablecer contraseña";
   // Fragment keeps the credential out of ordinary web access logs and Referer headers.
   url=base+(verify?"/verificar-correo":"/restablecer-contrasena")+"#token="+tokens.derive(type,data.path("nonce").asText());
   content=subject+"\n\n"+(verify?"Confirma tu dirección para acceder a tu cuenta.":"Recibimos una solicitud para restablecer tu contraseña.")
    +"\nEste enlace se puede usar una sola vez. Vence: "+data.path("expiresAt").asText()+".\nSi no solicitaste esta acción, ignora este correo.";
  } else if("ORDER_CONFIRMED".equals(type)) {
   String order=data.path("orderId").asText();
   if(!order.matches("[1-9][0-9]*"))throw new IllegalArgumentException("Pedido inválido.");
   subject="PLIEGO · Pedido #"+order+" confirmado"; label="Consultar pedido"; url=base+"/orders/"+order;
   var text=new StringBuilder("Pedido #").append(order).append("\nGracias por tu compra en PLIEGO.\nFecha: ").append(data.path("date").asText()).append("\n\n");
   for(JsonNode item:data.path("items")) text.append(item.path("title").asText()).append("\nCantidad: ")
    .append(item.path("quantity").asText()).append(" · Precio unitario: ").append(item.path("unitPrice").asText())
    .append(" · Subtotal: ").append(item.path("subtotal").asText()).append("\n");
   if(data.has("subtotal"))text.append("\nSubtotal: ").append(data.path("subtotal").asText());
   if(data.has("taxRate")&&data.has("taxAmount"))text.append("\nIVA (").append(data.path("taxRate").asText()).append("%): ").append(data.path("taxAmount").asText());
   if(data.has("shippingAmount"))text.append("\nEnvío: ").append(data.path("shippingAmount").asText());
   text.append("\nTotal: ").append(data.path("total").asText());
   JsonNode delivery=data.path("delivery");
   if(delivery.isObject()) {
    text.append("\n\nEntrega a domicilio:\n");
    for(String field:new String[]{"recipient","line1","line2","city","province","country","postalCode"})
     if(delivery.hasNonNull(field)&&!delivery.path(field).asText().isBlank())text.append(delivery.path(field).asText()).append("\n");
   }
   JsonNode pickup=data.path("pickup");
   if(pickup.isObject()) {
    JsonNode location=pickup.path("location");
    text.append("\n\nRetiro en tienda:\n");
    for(String field:new String[]{"name","address","city","province","countryCode","postalCode"})
     if(location.hasNonNull(field))text.append(location.path(field).asText()).append("\n");
    var ready=java.time.OffsetDateTime.parse(pickup.path("readyAt").asText())
     .atZoneSameInstant(java.time.ZoneId.of(location.path("timezone").asText()));
    text.append("Hora estimada de retiro: ").append(ready.format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm")))
     .append(" (").append(location.path("timezone").asText()).append(")\nCódigo de retiro: ").append(pickup.path("pickupCode").asText())
     .append("\nPresenta esta confirmación al recoger tu pedido.");
   }
   content=text.toString();
  } else throw new IllegalArgumentException("Tipo de correo inválido.");
  String html="<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"></head><body style=\"margin:0;background:#f7f4ed;color:#25291f;font-family:Arial,sans-serif\">"
   +"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr><td align=\"center\" style=\"padding:24px\">"
   +"<table role=\"presentation\" width=\"100%\" style=\"max-width:600px;background:#fff\"><tr><td style=\"padding:32px\">"
   +"<div style=\"font-family:Georgia,serif;font-size:32px;color:#3c5739\">PLIEGO</div><h1 style=\"font-size:22px\">"+escape(subject)+"</h1>"
   +"<p style=\"font-size:16px;line-height:1.6\">"+escape(content).replace("\n","<br>")+"</p>"
   +"<p><a href=\""+escape(url)+"\" style=\"background:#3c5739;color:white;padding:12px 18px;display:inline-block\">"+escape(label)+"</a></p>"
   +"<p style=\"font-size:12px;word-break:break-all\">Si el botón no funciona, copia este enlace:<br>"+escape(url)+"</p>"
   +"</td></tr></table></td></tr></table></body></html>";
  return new MailMessage(subject,html,content+"\n\n"+label+": "+url);
 }
 private static String escape(String value) {
  return value.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;");
 }
}
