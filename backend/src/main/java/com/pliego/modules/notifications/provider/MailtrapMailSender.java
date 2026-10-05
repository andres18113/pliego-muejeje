package com.pliego.modules.notifications.provider;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
 public void send(String recipient,MailMessage message,String type) {
  if(recipient==null||!recipient.matches("[^\\s<>@]+@[^\\s<>@]+")||MailProperties.unsafe(recipient)||MailProperties.unsafe(message.subject()))
   throw new MailDeliveryException("FAILED","MAIL_HEADER_INVALID");
  String payload=json.writeValueAsString(Map.of("from",Map.of("email",properties.fromAddress(),"name",properties.fromName()),
   "to",List.of(Map.of("email",recipient)),"subject",message.subject(),"html",message.html(),"text",message.text(),"category",type));
  var request=HttpRequest.newBuilder(properties.endpoint()).timeout(properties.requestTimeout())
   .header("Authorization","Bearer "+properties.token()).header("Content-Type","application/json")
   .POST(HttpRequest.BodyPublishers.ofString(payload)).build();
  try {
   // Headers suffice: never retain/log provider response bodies or reflected personal data.
   var response=client.send(request,HttpResponse.BodyHandlers.discarding());
   int status=response.statusCode();
   if(status==200)return;
   throw new MailDeliveryException(status==429||status>=500?"RETRY":"FAILED","MAILTRAP_HTTP_"+status);
  } catch(InterruptedException e) {Thread.currentThread().interrupt();throw new MailDeliveryException("FAILED","AMBIGUOUS_DELIVERY");}
  catch(IOException e) {throw new MailDeliveryException("FAILED","AMBIGUOUS_DELIVERY");}
 }
}
