package com.pliego.modules.notifications;

import static org.junit.jupiter.api.Assertions.*;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import com.pliego.modules.identity.application.EmailActionTokens;
import com.pliego.modules.notifications.application.*;
import com.pliego.modules.notifications.gateway.MailOutboxGateway;
import com.pliego.modules.notifications.provider.MailtrapMailSender;

class TransactionalMailTest {
 private final ObjectMapper json=new ObjectMapper();
 private final EmailActionTokens tokens=new EmailActionTokens("0123456789abcdef0123456789abcdef");

 private MailProperties settings(URI endpoint) {
  return new MailProperties(true,endpoint,"test-token","pliego@example.com","PLIEGO",URI.create("https://pliego.example"),true,
    Duration.ofSeconds(1),Duration.ofSeconds(2),5);
 }
 @Test void actionTokensHaveSeparatePurposesAndNoRawPersistedCredential() {
  var first=tokens.issue("VERIFY_EMAIL"); var second=tokens.issue("VERIFY_EMAIL");
  assertNotEquals(first.nonce(),second.nonce());
  String raw=tokens.derive("VERIFY_EMAIL",first.nonce());
  assertTrue(raw.matches("[A-Za-z0-9_-]{43}"));
  assertEquals(first.hash(),EmailActionTokens.hash(raw));
  assertNotEquals(raw,tokens.derive("RESET_PASSWORD",first.nonce()));
  assertFalse(first.toString().contains(first.nonce()));
 }
 @Test void orderTemplateUsesRealSnapshotAndEscapesHtml() {
  var templates=new MailTemplates(settings(URI.create("http://127.0.0.1/api/send")),tokens,json);
  var msg=templates.render("ORDER_CONFIRMED",json.readTree("""
   {"orderId":"42","date":"2026-10-04T12:00:00Z","subtotal":"35.00","total":"35.00",
    "items":[{"title":"Libro <script> & \\"lectura\\"","quantity":2,"unitPrice":"17.50","subtotal":"35.00"}],
    "delivery":{"recipient":"Ana <Pérez>","line1":"Calle 1","city":"Quito","province":"Pichincha","country":"EC"}}
   """));
  assertTrue(msg.text().contains("Pedido #42")); assertTrue(msg.text().contains("Cantidad: 2"));
  assertTrue(msg.text().contains("Total: 35.00")); assertTrue(msg.text().contains("Calle 1"));
  assertTrue(msg.html().contains("&lt;script&gt;")); assertFalse(msg.html().contains("<script>"));
  assertTrue(msg.text().contains("https://pliego.example/orders/42"));
 }
 @Test void verificationAndResetContainSeparateConfiguredLinks() {
  var templates=new MailTemplates(settings(URI.create("http://127.0.0.1/api/send")),tokens,json);
  var credential=tokens.issue("VERIFY_EMAIL");
  var data=json.createObjectNode().put("nonce",credential.nonce()).put("expiresAt","2026-10-05T12:00:00Z");
  var verify=templates.render("VERIFY_EMAIL",data); var reset=templates.render("RESET_PASSWORD",data);
  assertTrue(verify.text().contains("/verificar-correo#token="));
  assertTrue(reset.text().contains("/restablecer-contrasena#token="));
  assertTrue(verify.html().contains("PLIEGO")); assertNotEquals(verify.text(),reset.text());
 }
 @Test void pickupConfirmationUsesSnapshotLocalTimeReferenceAndAuthoritativeTax() {
  var templates=new MailTemplates(settings(URI.create("http://127.0.0.1/api/send")),tokens,json);
  var message=templates.render("ORDER_CONFIRMED",json.readTree("""
   {"orderId":"12","date":"2026-10-04","subtotal":"10.00","taxRate":"15.00","taxAmount":"1.50","shippingAmount":"0.00","total":"11.50","items":[],
    "pickup":{"location":{"name":"PUCE <principal>","address":"Av. 12 de Octubre","city":"Quito","province":"Pichincha","countryCode":"EC","timezone":"America/Guayaquil"},
      "readyAt":"2026-10-04T18:25:00Z","pickupCode":"P-ABC234"}}
   """));
  assertTrue(message.text().contains("PUCE <principal>"));assertTrue(message.html().contains("PUCE &lt;principal&gt;"));
  assertTrue(message.text().contains("13:25"));assertTrue(message.text().contains("P-ABC234"));
  assertTrue(message.text().contains("Presenta esta confirmación"));assertTrue(message.text().contains("IVA (15.00%): 1.50"));
  assertTrue(message.text().contains("Envío: 0.00"));assertFalse(message.text().contains("Entrega a domicilio:"));
 }
 @Test void providerUsesOfficialContractAndClassifiesFailuresWithoutLeakingResponse() throws Exception {
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  AtomicReference<String> body=new AtomicReference<>(); AtomicReference<String> auth=new AtomicReference<>();
  server.createContext("/api/send",exchange->{
   body.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
   auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
   byte[] reply="{\"success\":true,\"message_ids\":[\"test-id\"]}".getBytes(StandardCharsets.UTF_8);
   exchange.sendResponseHeaders(200,reply.length); exchange.getResponseBody().write(reply); exchange.close();
  }); server.start();
  try {
   var sender=new MailtrapMailSender(settings(URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/api/send")),json);
   sender.send("reader@example.com",new MailMessage("Pedido #42","<p>Gracias</p>","Gracias"),"ORDER_CONFIRMED");
   var payload=json.readTree(body.get()); assertEquals("Bearer test-token",auth.get());
   assertEquals("reader@example.com",payload.path("to").get(0).path("email").asText());
   assertEquals("Gracias",payload.path("text").asText()); assertEquals("<p>Gracias</p>",payload.path("html").asText());
   server.removeContext("/api/send");
   server.createContext("/api/send",exchange->{exchange.sendResponseHeaders(429,-1); exchange.close();});
   var failure=assertThrows(MailDeliveryException.class,()->sender.send("reader@example.com",new MailMessage("s","h","t"),"VERIFY_EMAIL"));
   assertEquals("RETRY",failure.outcome()); assertEquals("MAILTRAP_HTTP_429",failure.getMessage());
  } finally { server.stop(0); }
 }
 @Test void workerPersistsProviderFailureAndNeverHoldsBusinessTransaction() {
  var gateway=new FakeOutbox();
  var worker=new MailOutboxWorker(new MailOutboxService(gateway),
    (to,message,type)->{throw new MailDeliveryException("RETRY","MAILTRAP_HTTP_503");},
    new MailTemplates(settings(URI.create("http://127.0.0.1/api/send")),tokens,json),settings(URI.create("http://127.0.0.1/api/send")),json);
  worker.process(); assertEquals("RETRY",gateway.outcome); assertEquals("MAILTRAP_HTTP_503",gateway.error);
  assertEquals(1,gateway.claims);
 }
 @Test void providerTimeoutIsTerminalBecauseAcceptanceIsUnknown() throws Exception {
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/api/send",exchange->{
   try { Thread.sleep(350); exchange.sendResponseHeaders(200,-1); }
   catch(InterruptedException e) {Thread.currentThread().interrupt();}
   finally {exchange.close();}
  }); server.start();
  try {
   var settings=new MailProperties(true,URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/api/send"),"test-token",
    "pliego@example.com","PLIEGO",URI.create("https://pliego.example"),true,Duration.ofMillis(100),Duration.ofMillis(100),1);
   var sender=new MailtrapMailSender(settings,json);
   var failure=assertThrows(MailDeliveryException.class,()->sender.send("reader@example.com",new MailMessage("s","h","t"),"VERIFY_EMAIL"));
   assertEquals("FAILED",failure.outcome()); assertEquals("AMBIGUOUS_DELIVERY",failure.getMessage());
  } finally {server.stop(0);}
 }
 @Test void configurationRejectsHeaderInjectionAndInsecureProductionUrls() {
  assertThrows(IllegalArgumentException.class,()->new MailProperties(true,URI.create("https://send.api.mailtrap.io/api/send"),"token",
    "x@example.com\r\nBcc: victim@example.com","PLIEGO",URI.create("https://pliego.example"),false,Duration.ofSeconds(1),Duration.ofSeconds(5),5));
  assertThrows(IllegalArgumentException.class,()->new MailProperties(true,URI.create("https://send.api.mailtrap.io/api/send"),"token",
    "x@example.com","PLIEGO",URI.create("http://pliego.example"),false,Duration.ofSeconds(1),Duration.ofSeconds(5),5));
 }
 static class FakeOutbox implements MailOutboxGateway {
  int claims; String outcome; String error;
  public OutboxMail claim() { if(claims>0)return null; claims++; return new OutboxMail(42,UUID.randomUUID(),"ORDER_CONFIRMED","reader@example.com",1,
    "{\"orderId\":\"42\",\"date\":\"2026-10-04\",\"total\":\"5.00\",\"items\":[]}"); }
  public void complete(OutboxMail mail,String result,String code) {outcome=result;error=code;}
 }
}
