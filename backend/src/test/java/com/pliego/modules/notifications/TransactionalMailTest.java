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
  assertEquals("Tu pedido N.º 42 está confirmado",msg.subject());
  assertTrue(msg.text().contains("¡Gracias por tu compra!")); assertTrue(msg.text().contains("Pedido: N.º 42")); assertTrue(msg.text().contains("Cantidad: 2"));
  assertTrue(msg.text().contains("Fecha de compra: 4 de octubre de 2026"));
  assertTrue(msg.text().contains("Total pagado: $ 35,00")); assertTrue(msg.text().contains("Calle 1"));
  assertTrue(msg.text().contains("Entrega a domicilio:")); assertFalse(msg.text().contains("Mi biblioteca"));
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
  assertEquals("Verifica tu correo en PLIEGO",verify.subject());
  assertTrue(verify.text().contains("Confirma tu dirección de correo para terminar de configurar tu cuenta."));
  assertTrue(verify.text().contains("Verificar correo: https://pliego.example/verificar-correo#token="));
  assertTrue(verify.text().contains("vence el 5 de octubre de 2026, 07:00")); assertTrue(verify.text().contains("Si no creaste esta cuenta, puedes ignorar este mensaje."));
  assertTrue(verify.html().contains("copia este enlace")); assertTrue(reset.text().contains("Restablecer contraseña: "));
 }
 private MailTemplates templates() { return new MailTemplates(settings(URI.create("http://127.0.0.1/api/send")),tokens,json); }
 /** Writes the rendered message next to the build so its HTML can be opened and checked by eye. */
 private static MailMessage preview(String name,MailMessage message) throws Exception {
  var dir=java.nio.file.Path.of("target","mail-previews"); java.nio.file.Files.createDirectories(dir);
  java.nio.file.Files.writeString(dir.resolve(name+".html"),message.html()); java.nio.file.Files.writeString(dir.resolve(name+".txt"),message.subject()+"\n\n"+message.text());
  return message;
 }
 private static final String ITEMS="""
  "items":[{"title":"50 experimentos imprescindibles para entender la psicología social y otras preguntas que no sabías que tenías","authors":"Rodríguez, Armando (coord.); Morales Domínguez, José Francisco (coord.); Delgado, Naira","format":"PAPERBACK","quantity":2,"unitPrice":"63.96","subtotal":"127.92","originalSubtotal":"159.90","lineSavings":"31.98","coverUrl":"https://covers.example/a.webp"},
   {"title":"Administración de proyectos de informática","authors":"Toro López, Francisco J.","format":"EBOOK","quantity":1,"unitPrice":"17.99","subtotal":"17.99","originalSubtotal":"17.99","lineSavings":"0.00"}]""";
 @Test void discountedMixedConfirmationShowsServerSavingsAndBothDestinations() throws Exception {
  var msg=preview("order-confirmed-mixed-discount",templates().render("ORDER_CONFIRMED",json.readTree("{\"orderId\":\"229\",\"date\":\"2026-10-05T15:00:00Z\",\"subtotal\":\"145.91\",\"originalSubtotal\":\"177.89\",\"savingsTotal\":\"31.98\",\"taxRate\":\"15.00\",\"taxAmount\":\"21.89\",\"shippingAmount\":\"3.50\",\"total\":\"171.30\","+ITEMS
   +",\"delivery\":{\"recipient\":\"Ana Pérez\",\"line1\":\"Av. Principal 123\",\"line2\":null,\"city\":\"Quito\",\"province\":\"Pichincha\",\"country\":\"EC\",\"postalCode\":\"170150\"}}")));
  assertTrue(msg.text().contains("Tu pedido N.º 229 está confirmado.")); assertTrue(msg.text().contains("Subtotal: $ 177,89")); assertTrue(msg.text().contains("Ahorro total: -$ 31,98"));
  assertTrue(msg.text().contains("IVA (15 %): $ 21,89")); assertTrue(msg.text().contains("Envío: $ 3,50")); assertTrue(msg.text().contains("Total pagado: $ 171,30"));
  // The saving is the server's line figure; a line without one shows no previous price.
  assertTrue(msg.text().contains("Precio: $ 127,92 (antes $ 159,90)")); assertTrue(msg.text().contains("Ahorraste $ 31,98")); assertFalse(msg.text().contains("(antes $ 17,99)"));
  assertTrue(msg.text().contains("Rodríguez, Armando; Morales Domínguez, José Francisco; Delgado, Naira")); assertFalse(msg.text().contains("(coord.)"));
  assertTrue(msg.text().contains("Libro, Cantidad: 2")); assertTrue(msg.text().contains("eBook, Cantidad: 1"));
  assertTrue(msg.text().contains("Quito, Pichincha, Ecuador")); assertTrue(msg.text().contains("Tus eBooks y audiolibros de este pedido están en Mi biblioteca."));
  assertTrue(msg.html().contains("src=\"https://covers.example/a.webp\"")); assertTrue(msg.html().contains("<s>$&nbsp;159,90</s>"));
  assertTrue(msg.text().contains("Ver pedido: https://pliego.example/orders/229")); assertTrue(msg.text().contains("Ir a Mi biblioteca: https://pliego.example/biblioteca"));
 }
 @Test void digitalOnlyConfirmationHasNoShippingAndPointsToTheLibrary() throws Exception {
  var msg=preview("order-confirmed-digital",templates().render("ORDER_CONFIRMED",json.readTree("""
   {"orderId":"230","date":"2026-10-05T15:00:00Z","subtotal":"17.99","taxRate":"15.00","taxAmount":"2.70","shippingAmount":"0.00","total":"20.69",
    "items":[{"title":"Administración de proyectos de informática","quantity":1,"unitPrice":"17.99","subtotal":"17.99"}]}
   """)));
  assertFalse(msg.text().contains("Envío")); assertFalse(msg.text().contains("Entrega a domicilio")); assertFalse(msg.text().contains("Retiro en tienda"));
  assertTrue(msg.text().contains("Tu compra es digital: la encuentras en Mi biblioteca, sin envío.")); assertTrue(msg.text().contains("Total pagado: $ 20,69"));
  // No cover in the snapshot: a quiet block stands in, never a broken image. The only image is the logo.
  assertEquals(1,msg.html().split("<img",-1).length-1); assertTrue(msg.html().contains("<img src=\"https://pliego.example/brand/pliego-logo.png\" width=\"129\" height=\"30\" alt=\"PLIEGO\""));
 }
 @Test void statusMessagesShareOneSystemAndRefuseUnknownStates() throws Exception {
  String delivery="\"delivery\":{\"recipient\":\"Ana Pérez\",\"line1\":\"Av. Principal 123\",\"city\":\"Quito\",\"province\":\"Pichincha\",\"country\":\"EC\"}";
  var expected=java.util.Map.of("PREPARING","Estamos preparando tu pedido","IN_TRANSIT","Tu pedido está en camino","OUT_FOR_DELIVERY","Tu pedido está en reparto","DELIVERED","Tu pedido fue entregado");
  for(var entry:expected.entrySet()) {
   var msg=preview("order-status-delivery-"+entry.getKey().toLowerCase(),templates().render("ORDER_STATUS",json.readTree("{\"orderId\":\"229\",\"method\":\"HOME_DELIVERY\",\"state\":\""+entry.getKey()+"\",\"carrier\":\"Servientrega\",\"trackingCode\":\"SV-123\","+ITEMS+","+delivery+"}")));
   assertTrue(msg.text().contains(entry.getValue())); assertTrue(msg.text().contains("Pedido: N.º 229")); assertTrue(msg.text().contains("Guía de seguimiento: SV-123"));
   assertTrue(msg.text().contains("Ver pedido: https://pliego.example/orders/229")); assertFalse(msg.text().contains("Total pagado"));
  }
  assertEquals("Pedido N.º 229: entregado",templates().render("ORDER_STATUS",json.readTree("{\"orderId\":\"229\",\"method\":\"HOME_DELIVERY\",\"state\":\"DELIVERED\"}")).subject());
  String pickup="\"pickup\":{\"location\":{\"name\":\"PLIEGO Centro\",\"address\":\"Av. 12 de Octubre\",\"city\":\"Quito\",\"province\":\"Pichincha\",\"countryCode\":\"EC\",\"timezone\":\"America/Guayaquil\"},\"readyAt\":\"2026-10-04T18:25:00Z\",\"pickupCode\":\"P-ABC234\"}";
  var waiting=preview("order-status-pickup-pending",templates().render("ORDER_STATUS",json.readTree("{\"orderId\":\"12\",\"method\":\"STORE_PICKUP\",\"state\":\"PENDING\","+pickup+"}")));
  assertTrue(waiting.text().contains("Tu pedido está pendiente de retiro")); assertTrue(waiting.text().contains("PLIEGO Centro")); assertTrue(waiting.text().contains("Código de retiro: P-ABC234"));
  assertTrue(waiting.text().contains("Hora estimada de retiro: 4 de octubre de 2026, 13:25"));
  var preparing=preview("order-status-pickup-preparing",templates().render("ORDER_STATUS",json.readTree("{\"orderId\":\"12\",\"method\":\"STORE_PICKUP\",\"state\":\"PREPARING\","+pickup+"}")));
  assertTrue(preparing.text().contains("Estamos preparando tu pedido para retiro"));
  assertTrue(preparing.text().contains("Consulta en tu pedido la hora estimada para retirarlo."));
  assertFalse(preparing.text().contains("Te avisaremos cuando esté listo"));
  assertTrue(preparing.text().contains("Código de retiro: P-ABC234"));
  assertTrue(preparing.text().contains("Hora estimada de retiro: 4 de octubre de 2026, 13:25"));
  var collected=preview("order-status-pickup-collected",templates().render("ORDER_STATUS",json.readTree("{\"orderId\":\"12\",\"method\":\"STORE_PICKUP\",\"state\":\"COLLECTED\","+pickup+"}")));
  assertTrue(collected.text().contains("Retiraste tu pedido")); assertFalse(collected.text().contains("Código de retiro"));
  var complete=preview("order-status-digital-completed",templates().render("ORDER_STATUS",json.readTree("{\"orderId\":\"230\",\"method\":\"DIGITAL\",\"state\":\"COMPLETED\"}")));
  assertTrue(complete.text().contains("Tu compra está completa")); assertTrue(complete.text().contains("Ir a Mi biblioteca: https://pliego.example/biblioteca"));
  // The template renders the state it is given; it never invents one.
  assertThrows(IllegalArgumentException.class,()->templates().render("ORDER_STATUS",json.readTree("{\"orderId\":\"229\",\"method\":\"HOME_DELIVERY\",\"state\":\"TELEPORTED\"}")));
  assertThrows(IllegalArgumentException.class,()->templates().render("ORDER_STATUS",json.readTree("{\"orderId\":\"229\",\"method\":\"STORE_PICKUP\",\"state\":\"DELIVERED\"}")));
 }
 @Test void cancellationSpeaksOfTheOrderAndTheMoneyOnly() throws Exception {
  var msg=preview("order-cancelled-refunded",templates().render("ORDER_CANCELLED",json.readTree("{\"orderId\":\"229\",\"paymentState\":\"REFUNDED\",\"refundAmount\":\"171.30\",\"actionPath\":\"/orders/229\","+ITEMS+"}")));
  assertEquals("Pedido N.º 229 cancelado",msg.subject());
  assertTrue(msg.text().contains("Tu pedido fue cancelado")); assertTrue(msg.text().contains("El pago fue reembolsado.")); assertTrue(msg.text().contains("No necesitas realizar ninguna acción adicional."));
  assertTrue(msg.text().contains("Reembolso: $ 171,30"));
  // A refunded purchase saved nothing: the titles keep what was paid, without the saving or the previous price.
  assertTrue(msg.text().contains("Precio: $ 127,92")); assertFalse(msg.text().contains("Ahorra")); assertFalse(msg.text().contains("(antes"));
  for(String internal:new String[]{"existencias","inventario","titularidad","REFUNDED","revoc"}) assertFalse(msg.text().toLowerCase().contains(internal.toLowerCase()),internal);
  var unpaid=templates().render("ORDER_CANCELLED",json.readTree("{\"orderId\":\"231\",\"paymentState\":\"PENDING\"}"));
  assertFalse(unpaid.text().contains("reembols")); assertTrue(unpaid.text().contains("No necesitas realizar ninguna acción adicional."));
 }
 @Test void longAndHostileContentStaysEscapedInBothParts() throws Exception {
  var msg=preview("order-confirmed-long-hostile",templates().render("ORDER_CONFIRMED",json.readTree("""
   {"orderId":"987654321","date":"2026-10-05T15:00:00Z","originalSubtotal":"12345.67","savingsTotal":"1234.56","taxRate":"15.00","taxAmount":"1666.67","shippingAmount":"3.50","total":"12781.28",
    "items":[{"title":"Fundamentosdeelectromagnetismoparaingenieríaconaplicacionesindustrialesavanzadasyejerciciosresueltos <b>negrita</b> & \\"comillas\\" 'simples'","authors":"Apellido Muy Largo de Prueba, Nombre Compuesto Extenso (coord.); Otro Autor Con Nombre Bastante Largo, María Fernanda (ed.); Tercero, Juan","format":"HARDCOVER","quantity":10,"unitPrice":"1111.11","subtotal":"11111.11","originalSubtotal":"12345.67","lineSavings":"1234.56","coverUrl":"https://covers.example/a.webp"},
     {"title":"<img src=x onerror=alert(1)>","authors":"<script>alert(1)</script>","format":"AUDIOBOOK","quantity":1,"unitPrice":"0.00","subtotal":"0.00","coverUrl":"javascript:alert(1)"}],
    "delivery":{"recipient":"María Fernanda de los Ángeles Rodríguez-Echeverría y Montenegro <ana@example.com>","line1":"Urbanización Los Álamos del Valle, Avenida de los Granados N45-123 y Eloy Alfaro, Edificio Torre Central, piso 12, oficina 1204","line2":"Referencia: \\"frente al parque\\" & <portón azul>","city":"Quito","province":"Pichincha","country":"EC","postalCode":"170150"}}
   """)));
  String html=msg.html();
  for(String raw:new String[]{"<b>","<script>","onerror=alert(1)>","javascript:","<portón","<ana@example.com>"}) assertFalse(html.contains(raw),raw);
  assertTrue(html.contains("&lt;b&gt;negrita&lt;/b&gt; &amp; &quot;comillas&quot; &#39;simples&#39;")); assertTrue(html.contains("&lt;img src=x onerror=alert(1)&gt;"));
  // Only the logo and the one https cover are drawn; the unsafe cover address is left out.
  assertEquals(2,html.split("<img",-1).length-1); assertTrue(html.contains("src=\"https://covers.example/a.webp\""));
  assertTrue(msg.text().contains("<b>negrita</b> & \"comillas\" 'simples'")); assertTrue(msg.text().contains("Quito, Pichincha, Ecuador"));
  assertTrue(msg.text().contains("Ahorro total: -$ 1.234,56")); assertTrue(msg.text().contains("Total pagado: $ 12.781,28")); assertTrue(msg.text().contains("Ver pedido: https://pliego.example/orders/987654321"));
 }
 @Test void everyMessageIsSafeForMailClientsAndNamesNoProviderOrInternalState() throws Exception {
  var credential=tokens.issue("VERIFY_EMAIL");
  var action=json.createObjectNode().put("nonce",credential.nonce()).put("expiresAt","2026-10-05T12:00:00Z");
  var messages=java.util.List.of(preview("verify-email",templates().render("VERIFY_EMAIL",action)),preview("reset-password",templates().render("RESET_PASSWORD",action)),
   templates().render("ORDER_CONFIRMED",json.readTree("{\"orderId\":\"229\",\"date\":\"2026-10-05T15:00:00Z\",\"total\":\"1.00\","+ITEMS+"}")),
   templates().render("ORDER_CANCELLED",json.readTree("{\"orderId\":\"229\",\"paymentState\":\"REFUNDED\"}")));
  for(var message:messages) {
   String html=message.html();
   assertTrue(html.startsWith("<!doctype html><html lang=\"es\">")); assertTrue(html.contains("name=\"color-scheme\" content=\"light only\""));
   assertTrue(html.contains("max-width:600px")); assertTrue(html.contains("role=\"presentation\""));
   for(String unsafe:new String[]{"<script","javascript:","<link","@import","position:fixed","<form"}) assertFalse(html.toLowerCase().contains(unsafe),unsafe);
   // PLIEGO's own colours only: ultramar for the action, no legacy green or serif wordmark, no lavender.
   assertTrue(html.contains("#283da8")); for(String legacy:new String[]{"#3c5739","Georgia","#e4def4","#f7f4ed"}) assertFalse(html.contains(legacy),legacy);
   for(String internal:new String[]{"Mailtrap","outbox","ORDER_CONFIRMED","VERIFY_EMAIL","nonce"}) { assertFalse(html.contains(internal),internal); assertFalse(message.text().contains(internal),internal); }
   assertTrue(message.text().startsWith("PLIEGO\n\n"));
  }
  assertThrows(IllegalArgumentException.class,()->templates().render("NEWSLETTER",json.createObjectNode()));
  assertThrows(IllegalArgumentException.class,()->templates().render("ORDER_CONFIRMED",json.readTree("{\"orderId\":\"0\"}")));
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
  assertTrue(message.text().contains("Presenta esta confirmación"));assertTrue(message.text().contains("IVA (15 %): $ 1,50"));
  assertTrue(message.text().contains("Envío: $ 0,00"));assertFalse(message.text().contains("Entrega a domicilio:"));
  assertTrue(message.text().contains("Hora estimada de retiro: 4 de octubre de 2026, 13:25"));assertTrue(message.text().contains("Código de retiro: P-ABC234"));
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
   var receipt=sender.send("reader@example.com",new MailMessage("Pedido #42","<p>Gracias</p>","Gracias"),"ORDER_CONFIRMED",42);
   var payload=json.readTree(body.get()); assertEquals("Bearer test-token",auth.get());
   assertEquals("test-id",receipt.providerMessageId());
   assertEquals("reader@example.com",payload.path("to").get(0).path("email").asText());
   assertEquals("Gracias",payload.path("text").asText()); assertEquals("<p>Gracias</p>",payload.path("html").asText());
   assertEquals("ORDER_CONFIRMED",payload.path("category").asText());
   assertEquals("42",payload.path("custom_variables").path("pliego_outbox_id").asText());
   server.removeContext("/api/send");
   server.createContext("/api/send",exchange->{exchange.sendResponseHeaders(429,-1); exchange.close();});
   var failure=assertThrows(MailDeliveryException.class,()->sender.send("reader@example.com",new MailMessage("s","h","t"),"VERIFY_EMAIL",43));
   assertEquals("RETRY",failure.outcome()); assertEquals("MAILTRAP_HTTP_429",failure.getMessage());
  } finally { server.stop(0); }
 }
 @Test void workerPersistsProviderFailureAndNeverHoldsBusinessTransaction() {
  var gateway=new FakeOutbox();
  var worker=new MailOutboxWorker(new MailOutboxService(gateway),
    (to,message,type,outboxId)->{throw new MailDeliveryException("RETRY","MAILTRAP_HTTP_503");},
    new MailTemplates(settings(URI.create("http://127.0.0.1/api/send")),tokens,json),settings(URI.create("http://127.0.0.1/api/send")),json);
  worker.process(); assertEquals("RETRY",gateway.outcome); assertEquals("MAILTRAP_HTTP_503",gateway.error);
  assertEquals(1,gateway.claims);
 }
 @Test void workerPersistsTheProviderReceiptAgainstTheOutboxEntry() {
  var gateway=new FakeOutbox();
  var worker=new MailOutboxWorker(new MailOutboxService(gateway),
    (to,message,type,outboxId)->{assertEquals(42,outboxId);return new MailDeliveryReceipt("mailtrap-accepted-id");},
    new MailTemplates(settings(URI.create("http://127.0.0.1/api/send")),tokens,json),settings(URI.create("http://127.0.0.1/api/send")),json);
  worker.process();
  assertEquals("SENT",gateway.outcome); assertEquals("mailtrap-accepted-id",gateway.providerMessageId);
 }
 @Test
 @org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
 void staleWorkerCompletionDoesNotReportPersistedSuccess(org.springframework.boot.test.system.CapturedOutput output) {
  var gateway=new FakeOutbox(); gateway.staleCompletion=true;
  var worker=new MailOutboxWorker(new MailOutboxService(gateway),
    (to,message,type,outboxId)->new MailDeliveryReceipt("late-provider-id"),templates(),settings(URI.create("http://127.0.0.1/api/send")),json);
  worker.process();
  assertTrue(output.getOut().contains("state=STALE_COMPLETION"));
  assertFalse(output.getOut().contains("state=SENT"));
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
   var failure=assertThrows(MailDeliveryException.class,()->sender.send("reader@example.com",new MailMessage("s","h","t"),"VERIFY_EMAIL",42));
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
  int claims; String outcome; String error; String providerMessageId; boolean staleCompletion;
  public OutboxMail claim() { if(claims>0)return null; claims++; return new OutboxMail(42,UUID.randomUUID(),"ORDER_CONFIRMED","reader@example.com",1,
    "{\"orderId\":\"42\",\"date\":\"2026-10-04\",\"total\":\"5.00\",\"items\":[]}"); }
  public boolean complete(OutboxMail mail,String result,String code,String providerId) {
   if(staleCompletion)return false;
   outcome=result;error=code;providerMessageId=providerId;
   return true;
  }
 }
}
