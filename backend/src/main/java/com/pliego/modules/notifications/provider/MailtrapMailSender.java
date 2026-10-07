package com.pliego.modules.notifications.provider;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import com.pliego.modules.notifications.application.*;

@Component
@ConditionalOnProperty(name="pliego.mail.enabled",havingValue="true")
public final class MailtrapMailSender implements TransactionalMailSender {
 private final MailProperties properties;
 private final ObjectMapper json;
 private final HttpClient client;
 public MailtrapMailSender(MailProperties properties,ObjectMapper json) {
  this.properties=properties;this.json=json;
  client=HttpClient.newBuilder().connectTimeout(properties.connectTimeout()).followRedirects(HttpClient.Redirect.NEVER).build();
 }
 public MailDeliveryReceipt send(String recipient,MailMessage message,String type,long outboxId) {
  if(recipient==null||!recipient.matches("[^\\s<>@]+@[^\\s<>@]+")||MailProperties.unsafe(recipient)||MailProperties.unsafe(message.subject()))
   throw new MailDeliveryException("FAILED","MAIL_HEADER_INVALID");
  String payload=json.writeValueAsString(Map.of("from",Map.of("email",properties.fromAddress(),"name",properties.fromName()),
   "to",List.of(Map.of("email",recipient)),"subject",message.subject(),"html",message.html(),"text",message.text(),"category",type,
   "custom_variables",Map.of("pliego_outbox_id",Long.toString(outboxId))));
  var request=HttpRequest.newBuilder(properties.endpoint()).timeout(properties.requestTimeout())
   .header("Authorization","Bearer "+properties.token()).header("Content-Type","application/json")
   .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
  try {
   var response=client.send(request,HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
   int status=response.statusCode();
   if(status==200)return receipt(response.body());
   throw new MailDeliveryException(status==429||status>=500?"RETRY":"FAILED","MAILTRAP_HTTP_"+status);
  } catch(InterruptedException e) {Thread.currentThread().interrupt();throw new MailDeliveryException("FAILED","AMBIGUOUS_DELIVERY");}
  catch(IOException e) {throw new MailDeliveryException("FAILED","AMBIGUOUS_DELIVERY");}
 }
 private MailDeliveryReceipt receipt(String responseBody) {
  try {
   var response=json.readTree(responseBody);
   var ids=response.path("message_ids");
   if(!response.path("success").asBoolean(false)||!ids.isArray()||ids.size()!=1||!ids.get(0).isTextual())
    throw new MailDeliveryException("FAILED","AMBIGUOUS_DELIVERY");
   return new MailDeliveryReceipt(ids.get(0).asText());
  } catch(MailDeliveryException e) {throw e;}
  catch(Exception e) {throw new MailDeliveryException("FAILED","AMBIGUOUS_DELIVERY");}
 }
}
