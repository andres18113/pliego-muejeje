package com.pliego.modules.notifications.application;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.pliego.modules.identity.application.EmailActionTokens;
import com.pliego.modules.identity.application.AuthReturnPaths;
import com.pliego.modules.notifications.application.MailLayout.Fact;
import com.pliego.modules.notifications.application.MailLayout.Item;

/**
 * PLIEGO's transactional messages, each composed from {@link MailLayout}. A message renders the snapshot it is given:
 * states, amounts, places and codes come from the outbox payload and are never derived here. Optional fields (authors,
 * covers, the medium, original prices and savings) are drawn when the payload carries them and left out otherwise.
 */
@Component
public final class MailTemplates {
 private final MailProperties properties;
 private final EmailActionTokens tokens;
 private final Map<String,String> emailCoverRenditions;
 public MailTemplates(MailProperties properties,EmailActionTokens tokens,ObjectMapper mapper) {
  this.properties=properties; this.tokens=tokens;
  this.emailCoverRenditions=loadEmailCoverRenditions(mapper);
 }
 public MailMessage render(String type,JsonNode data) {
  String base=properties.publicUrl().toString().replaceAll("/+$","");
  return switch(type) {
   case "VERIFY_EMAIL","RESET_PASSWORD" -> emailAction(type,data,base);
   case "EMAIL_CHANGE_CONFIRM","EMAIL_CHANGE_REQUESTED","EMAIL_CHANGED" -> emailChange(type,data,base);
   case "ORDER_CONFIRMED" -> orderConfirmed(data,base);
   case "ORDER_STATUS" -> orderStatus(data,base);
   case "ORDER_CANCELLED" -> orderCancelled(data,base);
   case "INVOICE_ISSUED" -> invoiceIssued(data,base);
   case "BILLING_IDENTITY_DECIDED" -> billingIdentityDecision(data,base);
   default -> throw new IllegalArgumentException("Tipo de correo inválido.");
  };
 }

 private MailMessage billingIdentityDecision(JsonNode data,String base) {
  String state=data.path("status").asText("");
  var mail=new MailLayout("Revisamos tu solicitud de corrección de identificación.",base);
  String subject;
  if("APPROVED".equals(state)) {
   String type=data.path("identityType").asText("");
   String number=data.path("identityNumber").asText("");
   if(!(("EC_CEDULA".equals(type)&&number.matches("[0-9]{10}"))
     ||("EC_RUC".equals(type)&&number.matches("[0-9]{13}"))))
    throw new IllegalArgumentException("Datos de identificación inválidos.");
   subject="Aprobamos tu corrección de identificación";
   mail.heading(subject).lead("Tu cuenta ahora usa "+("EC_CEDULA".equals(type)?"la cédula ":"el RUC ")+number+".")
    .paragraph("Las facturas ya emitidas conservan sus datos originales.");
  } else if("REJECTED".equals(state)) {
   String reason=data.path("decisionReason").asText("");
   if(reason.isBlank())throw new IllegalArgumentException("El motivo de la decisión es obligatorio.");
   subject="Revisamos tu corrección de identificación";
   mail.heading(subject).lead("No aprobamos el cambio solicitado.").paragraph(reason);
  } else throw new IllegalArgumentException("Decisión de identificación inválida.");
  return mail.button("Ver identificación",base+"/account/identity").build(subject);
 }

 /** A pending identity keeps its confirmation and its recovery action on separate credentials. */
 private MailMessage emailChange(String type,JsonNode data,String base) {
  if("EMAIL_CHANGE_CONFIRM".equals(type)) {
   String url=base+"/confirmar-correo#token="+tokens.derive("EMAIL_CHANGE_CONFIRM",data.path("nonce").asText());
   return new MailLayout("Confirma tu nuevo correo para usarlo en tu cuenta de PLIEGO.",base)
    .heading("Confirma tu nuevo correo")
    .lead("Confirma esta dirección para usarla en tu cuenta de PLIEGO. Hasta que lo hagas, tu cuenta sigue usando tu correo actual.")
    .button("Confirmar correo",url)
    .muted("El enlace vence en 24 horas. Si no pediste este cambio, ignora este mensaje.")
    .fallback(url).build("Confirma tu nuevo correo en PLIEGO");
  }
  String masked=data.path("maskedEmail").asText("");
  if(masked.isBlank()||MailProperties.unsafe(masked))throw new IllegalArgumentException("Datos de cambio de correo inválidos.");
  if("EMAIL_CHANGE_REQUESTED".equals(type)) {
   String url=base+"/cancelar-cambio-correo#token="+tokens.derive("EMAIL_CHANGE_CANCEL",data.path("nonce").asText());
   return new MailLayout("Se pidió cambiar el correo de tu cuenta PLIEGO.",base)
    .heading("¿Cambiaste tu correo?")
    .lead("Se pidió usar "+masked+" como correo de tu cuenta. Tu cuenta seguirá usando esta dirección hasta que se confirme el cambio.")
    .button("No fui yo: cancelar el cambio",url)
    .muted("Si fuiste tú, no necesitas hacer nada.")
    .fallback(url).build("Se pidió cambiar el correo de tu cuenta PLIEGO");
  }
  return new MailLayout("El correo de tu cuenta PLIEGO cambió.",base)
   .heading("Tu correo cambió")
   .lead("Desde ahora tu cuenta usa "+masked+". Si no fuiste tú, escríbenos desde Ayuda.")
   .button("Ir a Ayuda",base+"/ayuda").build("El correo de tu cuenta PLIEGO cambió");
 }

 /** One stable, authenticated store URL; neither invoice bytes nor identity numbers enter the message. */
 private MailMessage invoiceIssued(JsonNode data,String base) {
  String order=orderId(data);
  String label=orderLabel(data);
  String name=data.path("customerName").asText("");
  String documentNumber=data.path("documentNumber").asText("");
  if(name.isBlank()||MailProperties.unsafe(name)||!documentNumber.matches("999-999-[0-9]{9}"))
   throw new IllegalArgumentException("Datos de factura inválidos.");
  String url=base+"/orders/"+order+"/invoice";
  return new MailLayout("Tu factura académica N.° "+documentNumber+" está disponible.",base)
   .heading("Tu factura académica está disponible")
   .lead("Estimado(a) "+name)
   .paragraphWithNoWrap("Tienes una nueva factura académica N.° ",documentNumber,
    ", disponible para su visualización y descarga.")
   .facts(List.of(Fact.of("Pedido",label)))
   .muted("Es una simulación académica sin validez tributaria y no constituye una factura electrónica autorizada por el SRI.")
   .button("Visualizar documento",url)
   .build("Tu factura académica "+documentNumber);
 }

 /** Verification (first send and every resend) and password reset: one statement, one action, what to do if it was not you. */
 private MailMessage emailAction(String type,JsonNode data,String base) {
  boolean verify="VERIFY_EMAIL".equals(type);
  // Fragment keeps the credential out of ordinary web access logs and Referer headers.
  String returnTo=AuthReturnPaths.safeOrNull(data.path("returnTo").asText(null));
  String context=returnTo==null?"":"?from="+java.net.URLEncoder.encode(returnTo,java.nio.charset.StandardCharsets.UTF_8);
  String url=base+(verify?"/verificar-correo":"/restablecer-contrasena")+context+"#token="+tokens.derive(type,data.path("nonce").asText());
  String subject=verify?"Verifica tu correo en PLIEGO":"Restablece tu contraseña en PLIEGO";
  var mail=new MailLayout(verify?"Confirma tu dirección de correo para terminar de configurar tu cuenta.":"Elige una contraseña nueva para tu cuenta.",base)
   .heading(verify?"Verifica tu correo":"Restablece tu contraseña")
   .lead(verify?"Confirma tu dirección de correo para terminar de configurar tu cuenta.":"Recibimos una solicitud para restablecer la contraseña de tu cuenta.")
   .button(verify?"Verificar correo":"Restablecer contraseña",url);
  String expires=expiry(data.path("expiresAt").asText(null));
  mail.muted("Este enlace se puede usar una sola vez"+(expires==null?".":" y vence el "+expires+"."));
  mail.muted(verify?"Si no creaste esta cuenta, puedes ignorar este mensaje.":"Si no pediste este cambio, puedes ignorar este mensaje: tu contraseña seguirá siendo la misma.");
  return mail.fallback(url).build(subject);
 }

 /** The purchase as it was confirmed: what was bought and paid, and where it goes. */
 private MailMessage orderConfirmed(JsonNode data,String base) {
  String order=orderId(data);
  String label=orderLabel(data);
  String orderUrl=actionUrl(base,data,"actionPath","/orders/"+order);
  String libraryUrl=actionUrl(base,data,"libraryPath","/biblioteca");
  boolean delivery=data.path("delivery").isObject(); boolean pickup=data.path("pickup").isObject();
  var mail=new MailLayout("Tu pedido "+label+" está confirmado.",base)
   .heading("¡Gracias por tu compra!")
   .lead("Tu pedido "+label+" está confirmado.")
   .rule()
   .facts(List.of(Fact.of("Pedido",label),Fact.of("Fecha de compra",MailLayout.date(data.path("date").asText(null)))))
   .rule();
  boolean digitalItems=items(mail,data,true);
  mail.rule().facts(totals(data,delivery||pickup));
  if(delivery) { mail.rule().section("Entrega a domicilio").lines(address(data.path("delivery"))); }
  if(pickup) { mail.rule(); pickup(mail,data.path("pickup"),true); }
  // A purchase with nothing to deliver or collect is digital; a mixed one says so only when the items carry their medium.
  if(digitalItems||(!delivery&&!pickup)) {
   mail.rule().section("Mi biblioteca").paragraph(delivery||pickup
    ?"Tus eBooks y audiolibros de este pedido están en Mi biblioteca."
    :"Tu compra es digital: la encuentras en Mi biblioteca, sin envío.");
  }
  mail.button("Ver pedido",orderUrl);
  if(digitalItems||(!delivery&&!pickup))mail.link("Ir a Mi biblioteca",libraryUrl);
  return mail.build("Tu pedido "+label+" está confirmado");
 }

 /**
  * One system for every progress message. The payload names the fulfillment method and the state the backend reached;
  * a pair this template does not know is refused rather than guessed.
  */
 private MailMessage orderStatus(JsonNode data,String base) {
  String order=orderId(data);
  String label=orderLabel(data);
  String orderUrl=actionUrl(base,data,"actionPath","/orders/"+order);
  String libraryUrl=actionUrl(base,data,"libraryPath","/biblioteca");
  String method=data.path("method").asText(""); String state=data.path("state").asText("");
  record Status(String label,String headline,String line) {}
  Status status=switch(method+":"+state) {
   case "HOME_DELIVERY:PREPARING" -> new Status("en preparación","Estamos preparando tu pedido","Te avisaremos cuando salga hacia tu dirección.");
   case "HOME_DELIVERY:IN_TRANSIT","HOME_DELIVERY:SHIPPED" -> new Status("en camino","Tu pedido está en camino","Salió hacia tu dirección de entrega.");
   case "HOME_DELIVERY:OUT_FOR_DELIVERY" -> new Status("en reparto","Tu pedido está en reparto","Está en la última etapa de la entrega.");
   case "HOME_DELIVERY:DELIVERED" -> new Status("entregado","Tu pedido fue entregado","Esperamos que disfrutes tu lectura.");
   case "STORE_PICKUP:PENDING" -> new Status("pendiente de retiro","Tu pedido está pendiente de retiro","Presenta el código de retiro al recogerlo.");
   case "STORE_PICKUP:PREPARING" -> new Status("en preparación","Estamos preparando tu pedido para retiro","Consulta en tu pedido la hora estimada para retirarlo.");
   case "STORE_PICKUP:READY" -> new Status("listo para retiro","Tu pedido está listo para retiro","Presenta el código de retiro y tu documento de identidad al recogerlo.");
   case "STORE_PICKUP:COLLECTED" -> new Status("retirado","Retiraste tu pedido","Esperamos que disfrutes tu lectura.");
   case "DIGITAL:COMPLETED" -> new Status("compra completada","Tu compra está completa","Puedes revisar tus títulos en Mi biblioteca.");
   default -> throw new IllegalArgumentException("Estado de pedido inválido.");
  };
  var mail=new MailLayout(status.headline()+". Pedido "+label+".",base)
   .heading(status.headline())
   .lead(status.line())
   .rule()
   .facts(List.of(Fact.of("Pedido",label)));
  if(data.hasNonNull("trackingCode")) {
   var tracking=new ArrayList<Fact>();
   if(data.hasNonNull("carrier"))tracking.add(Fact.of("Transportista",data.path("carrier").asText()));
   tracking.add(Fact.of("Guía de seguimiento",data.path("trackingCode").asText()));
   mail.facts(tracking);
  }
  if(data.path("items").isArray()&&!data.path("items").isEmpty()) { mail.rule(); items(mail,data,true); }
  if("HOME_DELIVERY".equals(method)&&data.path("delivery").isObject()) mail.rule().section("Entrega a domicilio").lines(address(data.path("delivery")));
  if("STORE_PICKUP".equals(method)&&data.path("pickup").isObject()) {
   mail.rule(); pickup(mail,data.path("pickup"),"PENDING".equals(state)||"PREPARING".equals(state)||"READY".equals(state));
  }
  if("DIGITAL".equals(method)) return mail.button("Ir a Mi biblioteca",libraryUrl).link("Ver pedido",orderUrl).build("Pedido "+label+": "+status.label());
  return mail.button("Ver pedido",orderUrl).build("Pedido "+label+": "+status.label());
 }

 /** A cancelled order, in the customer's terms: what happened to the order and to the money. Nothing else. */
 private MailMessage orderCancelled(JsonNode data,String base) {
  String order=orderId(data);
  String label=orderLabel(data);
  String orderUrl=actionUrl(base,data,"actionPath","/orders/"+order);
  boolean refunded="REFUNDED".equals(data.path("paymentState").asText(""));
  var mail=new MailLayout("Tu pedido "+label+" fue cancelado.",base)
   .heading("Tu pedido fue cancelado")
   .lead(refunded?"El pago fue reembolsado.":"Este pedido no continuará.")
   .paragraph("No necesitas realizar ninguna acción adicional.")
   .rule();
  var facts=new ArrayList<Fact>();
  facts.add(Fact.of("Pedido",label));
  if(refunded&&MailLayout.positive(data.path("refundAmount").asText(null)))facts.add(Fact.total("Reembolso",MailLayout.money(data.path("refundAmount").asText())));
  mail.facts(facts);
  // A refunded purchase saved nothing: its titles are listed with what was paid, without the saving.
  if(data.path("items").isArray()&&!data.path("items").isEmpty()) { mail.rule(); items(mail,data,false); }
  return mail.button("Ver pedido",orderUrl).build("Pedido "+label+" cancelado");
 }

 /** Draws the purchased titles; answers whether the payload says any of them is digital. */
 private boolean items(MailLayout mail,JsonNode data,boolean savings) {
  boolean digital=false;
  for(JsonNode item:data.path("items")) {
   String format=item.path("format").asText(null);
   digital|="EBOOK".equals(format)||"AUDIOBOOK".equals(format);
   String paid=item.hasNonNull("subtotal")?MailLayout.money(item.path("subtotal").asText()):null;
   // The previous price and the saving are shown only together, and only when the server reports a saving.
   boolean saved=savings&&MailLayout.positive(item.path("lineSavings").asText(null))&&item.hasNonNull("originalSubtotal");
   mail.item(new Item(item.path("title").asText(""),authors(item.path("authors").asText(null)),medium(format),item.path("quantity").asText("1"),paid,
    saved?MailLayout.money(item.path("originalSubtotal").asText()):null,saved?MailLayout.money(item.path("lineSavings").asText()):null,cover(item.path("coverUrl").asText(null))));
  }
  return digital;
 }
 private static List<Fact> totals(JsonNode data,boolean physical) {
  var rows=new ArrayList<Fact>();
  boolean saved=MailLayout.positive(data.path("savingsTotal").asText(null))&&data.hasNonNull("originalSubtotal");
  if(saved) {
   rows.add(Fact.of("Subtotal",MailLayout.money(data.path("originalSubtotal").asText())));
   rows.add(Fact.saving("Ahorro total","-"+MailLayout.money(data.path("savingsTotal").asText())));
  } else if(data.hasNonNull("subtotal")) rows.add(Fact.of("Subtotal",MailLayout.money(data.path("subtotal").asText())));
  if(data.hasNonNull("taxRate")&&data.hasNonNull("taxAmount"))rows.add(Fact.of("IVA ("+MailLayout.percent(data.path("taxRate").asText())+")",MailLayout.money(data.path("taxAmount").asText())));
  // Shipping is a line of a purchase that is delivered or collected; a digital purchase has none to show.
  if(physical&&data.hasNonNull("shippingAmount"))rows.add(Fact.of("Envío",MailLayout.money(data.path("shippingAmount").asText())));
  rows.add(Fact.total("Total pagado",MailLayout.money(data.path("total").asText())));
  return rows;
 }
 private static List<String> address(JsonNode delivery) {
  var lines=new ArrayList<String>();
  for(String field:new String[]{"recipient","line1","line2"}) if(delivery.hasNonNull(field))lines.add(delivery.path(field).asText());
  lines.add(joined(delivery,"city","province","country"));
  if(delivery.hasNonNull("postalCode"))lines.add(delivery.path("postalCode").asText());
  return lines;
 }
 /** The pickup point as the order recorded it; the time and the code while the order still waits to be collected. */
 private static void pickup(MailLayout mail,JsonNode pickup,boolean waiting) {
  JsonNode location=pickup.path("location");
  var lines=new ArrayList<String>();
  for(String field:new String[]{"name","address"}) if(location.hasNonNull(field))lines.add(location.path(field).asText());
  lines.add(joined(location,"city","province","countryCode"));
  if(location.hasNonNull("postalCode"))lines.add(location.path("postalCode").asText());
  mail.section("Retiro en tienda").lines(lines);
  if(!waiting)return;
  if(pickup.hasNonNull("readyAt")&&location.hasNonNull("timezone"))
   mail.facts(List.of(Fact.of("Hora estimada de retiro",MailLayout.dateTime(pickup.path("readyAt").asText(),ZoneId.of(location.path("timezone").asText())))));
  if(pickup.path("preparationMinutes").asInt()==10)
   mail.muted("El retiro se habilita a los 10 minutos desde la aprobación del pago: 6 minutos para cancelar y 4 minutos adicionales de preparación. Si el punto está cerrado, estará disponible desde la próxima apertura y dentro de su horario de atención.");
  if(pickup.hasNonNull("pickupCode"))mail.code("Código de retiro",pickup.path("pickupCode").asText()).muted("Al retirar, muestra tu código de retiro y tu documento de identidad.");
 }
 private static String joined(JsonNode node,String... fields) {
  var parts=new ArrayList<String>();
  for(String field:fields) if(node.hasNonNull(field)&&!node.path(field).asText().isBlank())parts.add(field.startsWith("country")?country(node.path(field).asText()):node.path(field).asText());
  return String.join(", ",parts);
 }
 /** "EC" as "Ecuador"; a value that is not a known ISO country code is shown as it came. */
 private static String country(String value) {
  if(!value.matches("[A-Z]{2}"))return value;
  String name=Locale.of("",value).getDisplayCountry(Locale.forLanguageTag("es"));
  return name.isBlank()||name.equals(value)?value:name;
 }
 private static String orderLabel(JsonNode data) {
  String reference=data.path("orderReference").asText(null);
  if(reference==null||reference.isBlank())return "#"+orderId(data);
  if(!reference.matches("PL-[0-9]{4}-[0-9]{4}"))
   throw new IllegalArgumentException("Referencia de pedido inválida.");
  return "#"+reference;
 }
 private static String orderId(JsonNode data) {
  String order=data.path("orderId").asText();
  if(!order.matches("[1-9][0-9]*"))throw new IllegalArgumentException("Pedido inválido.");
  return order;
 }
 private static String actionUrl(String base,JsonNode data,String field,String fallback) {
  String path=data.path(field).asText(fallback);
  if(!path.startsWith("/")||path.startsWith("//")||path.contains("..")||path.contains("?")||path.contains("#")||path.contains("\\"))
   throw new IllegalArgumentException("Ruta de acción de pedido inválida.");
  return base+path;
 }
 private static String medium(String format) {
  if(format==null)return null;
  return switch(format) { case "EBOOK" -> "eBook"; case "AUDIOBOOK" -> "Audiolibro"; case "PAPERBACK","HARDCOVER" -> "Libro"; default -> null; };
 }
 /** Contributor names as shoppers read them: without editorial role marks such as "(coord.)". */
 private static String authors(String authors) {
  if(authors==null||authors.isBlank())return null;
  return authors.replaceAll("\\s*\\((?:coords?|eds?|dirs?|comps?)\\.\\)","").replaceAll("\\s+;",";").strip();
 }
 /** Only unsigned assets on the public cover CDN; invoice storage and authenticated store paths never enter images. */
 private String cover(String url) {
  if(!validCover(url))return null;
  String rendition=emailCoverRenditions.get(url);
  return validCover(rendition)?rendition:url;
 }
 private static boolean validCover(String url) {
  return url!=null&&url.matches("https://covers\\.pliegolibros\\.com/covers/editions/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\\.(?:webp|jpg|jpeg|png)");
 }
 /** Only generated, bundled mappings opt into JPEG; later covers keep their original validated URL. */
 private static Map<String,String> loadEmailCoverRenditions(ObjectMapper mapper) {
  try(var input=MailTemplates.class.getResourceAsStream("/notifications/email-cover-renditions.json")) {
   if(input==null)throw new IllegalStateException("No se encontró el mapa de portadas para correo.");
   JsonNode mapping=mapper.readTree(input);
   if(mapping==null||!mapping.isObject())throw new IllegalStateException("El mapa de portadas para correo no es válido.");
   var result=new HashMap<String,String>();
   for(var entry:mapping.properties()) {
    String source=entry.getKey();
    String target=entry.getValue().asText();
    if(validCover(source)&&source.endsWith(".webp")&&validCover(target)
       &&target.startsWith("https://covers.pliegolibros.com/covers/editions/email-v1/")&&target.endsWith(".jpg"))
     result.put(source,target);
   }
   return Map.copyOf(result);
  } catch(java.io.IOException failure) {
   throw new IllegalStateException("No se pudo leer el mapa de portadas para correo.",failure);
  }
 }
 private static String expiry(String value) {
  try { return value==null?null:MailLayout.dateTime(value,MailLayout.STORE_ZONE); }
  catch(java.time.format.DateTimeParseException invalid) { return null; }
 }
}
