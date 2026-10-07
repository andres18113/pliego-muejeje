package com.pliego.modules.notifications.application;

import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;

/**
 * PLIEGO's transactional email system: one shell (logo, one statement, short sections, one ultramar action, a quiet
 * foot) that every message is composed from, written once as email-client-safe HTML (tables, inline styles, no scripts,
 * no web fonts, no remote assets besides the logo and product covers) and once as coherent plain text. White sheet on warm paper,
 * ink type, ultramar for the action, green only for a saving. Every value is escaped; nothing here decides a state.
 */
final class MailLayout {
 static final ZoneId STORE_ZONE=ZoneId.of("America/Guayaquil");
 private static final Locale ES=Locale.forLanguageTag("es-EC");
 private static final String INK="#252740",MUTED="#595a6e",BLUE="#283da8",PAPER="#f6f5f0",RULE="#e3e2e8",SOFT="#f1f0eb",GREEN="#17522a",GREEN_FIELD="#d7f1dc";
 private static final String FONT="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";
 private final StringBuilder html=new StringBuilder();
 private final StringBuilder text=new StringBuilder();
 private final String preheader;
 private final String logoUrl;

 /** {@code base} is the store's public address; the logo is the raster copy of the approved lockup it serves. */
 MailLayout(String preheader,String base) { this.preheader=preheader; this.logoUrl=base+"/brand/pliego-logo.png"; }

 MailLayout heading(String value) {
  html.append("<h1 style=\"margin:0 0 12px;").append(FONT).append("font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:").append(INK).append("\">").append(escape(value)).append("</h1>");
  text.append(value).append("\n\n");
  return this;
 }
 MailLayout lead(String value) { return paragraph(value,"17px",INK); }
 MailLayout paragraph(String value) { return paragraph(value,"15px",INK); }
 MailLayout muted(String value) { return paragraph(value,"14px",MUTED); }
 private MailLayout paragraph(String value,String size,String color) {
  html.append("<p style=\"margin:0 0 12px;").append(FONT).append("font-size:").append(size).append(";line-height:1.55;color:").append(color).append("\">").append(escape(value)).append("</p>");
  text.append(value).append("\n");
  return this;
 }
 /** A hairline between sections, with a little air on both sides. */
 MailLayout rule() {
  html.append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td style=\"padding:16px 0\"><div style=\"border-top:1px solid ").append(RULE).append(";font-size:0;line-height:0\">&nbsp;</div></td></tr></table>");
  text.append("\n");
  return this;
 }
 /** A small section name over what follows ("Entrega a domicilio"). */
 MailLayout section(String value) {
  html.append("<h2 style=\"margin:0 0 8px;").append(FONT).append("font-size:15px;line-height:1.4;font-weight:700;color:").append(INK).append("\">").append(escape(value)).append("</h2>");
  text.append(value).append(":\n");
  return this;
 }
 /** Label and value pairs in two columns: the order's number and date, the lines of a total. */
 MailLayout facts(List<Fact> facts) {
  html.append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">");
  for(Fact fact:facts) {
   String color=fact.saving()?GREEN:INK; String size=fact.strong()?"18px":"15px";
   html.append("<tr><td style=\"padding:4px 12px 4px 0;").append(FONT).append("font-size:").append(size).append(";line-height:1.45;font-weight:").append(fact.strong()?"700":"400").append(";color:").append(fact.saving()?GREEN:(fact.strong()?INK:MUTED)).append("\">")
    .append(escape(fact.label())).append("</td><td align=\"right\" style=\"padding:4px 0;").append(FONT).append("font-size:").append(size).append(";line-height:1.45;font-weight:").append(fact.strong()?"700":"500").append(";color:").append(color).append("\">")
    .append(nonBreaking(escape(fact.value()))).append("</td></tr>");
   text.append(fact.label()).append(": ").append(fact.value()).append("\n");
  }
  html.append("</table>");
  return this;
 }
 /** Plain lines under a section: an address, a pickup point. Blank lines are skipped. */
 MailLayout lines(List<String> values) {
  html.append("<p style=\"margin:0 0 12px;").append(FONT).append("font-size:15px;line-height:1.55;color:").append(INK).append("\">");
  boolean first=true;
  for(String value:values) {
   if(value==null||value.isBlank())continue;
   if(!first)html.append("<br>");
   html.append(escape(value)); text.append(value).append("\n"); first=false;
  }
  html.append("</p>");
  return this;
 }
 /** One purchased title: cover (or a quiet block when there is none), title, authors, medium and quantity, and what was paid. */
 MailLayout item(Item item) {
  html.append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>")
   .append("<td width=\"56\" valign=\"top\" style=\"padding:8px 12px 8px 0\">");
  if(item.coverUrl()!=null) html.append("<img src=\"").append(escape(item.coverUrl())).append("\" width=\"56\" alt=\"\" style=\"display:block;width:56px;height:auto;border:0;border-radius:2px\">");
  else html.append("<div style=\"width:56px;height:84px;background:").append(SOFT).append(";border-radius:2px;font-size:0;line-height:0\">&nbsp;</div>");
  html.append("</td><td valign=\"top\" style=\"padding:8px 10px 8px 0;").append(FONT).append("font-size:14px;line-height:1.45;color:").append(MUTED).append(";word-break:break-word\">")
   .append("<div style=\"font-size:16px;line-height:1.3;font-weight:700;color:").append(INK).append("\">").append(escape(item.title())).append("</div>");
  text.append(item.title()).append("\n");
  if(item.authors()!=null) { html.append("<div>").append(escape(item.authors())).append("</div>"); text.append(item.authors()).append("\n"); }
  String detail=(item.medium()==null?"":item.medium()+", ")+"Cantidad: "+item.quantity();
  html.append("<div>").append(escape(detail)).append("</div>");
  text.append(detail);
  if(item.saving()!=null) html.append("<div style=\"padding-top:6px\"><span style=\"display:inline-block;padding:3px 8px;border-radius:6px;background:").append(GREEN_FIELD).append(";color:").append(GREEN).append(";font-size:13px;font-weight:600;word-break:normal;overflow-wrap:normal\">Ahorraste ").append(nonBreaking(escape(item.saving()))).append("</span></div>");
  html.append("</td>");
  if(item.paid()!=null) {
   html.append("<td valign=\"top\" align=\"right\" style=\"padding:8px 0;").append(FONT).append("font-size:16px;line-height:1.3;font-weight:700;color:").append(INK).append(";white-space:nowrap\">").append(nonBreaking(escape(item.paid())));
   text.append(" | Precio: ").append(item.paid());
   if(item.original()!=null) {
    html.append("<div style=\"font-size:13px;font-weight:400;color:").append(MUTED).append("\"><s>").append(nonBreaking(escape(item.original()))).append("</s></div>");
    text.append(" (antes ").append(item.original()).append(")");
   }
   html.append("</td>");
  }
  html.append("</tr></table>");
  if(item.saving()!=null)text.append("\nAhorraste ").append(item.saving());
  text.append("\n\n");
  return this;
 }
 /** A reference the customer shows or types: large, spaced, on a soft field. */
 MailLayout code(String label,String value) {
  html.append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:4px 0 12px\"><tr><td style=\"padding:12px 18px;background:").append(SOFT).append(";border-radius:10px;").append(FONT).append("font-size:13px;line-height:1.4;color:").append(MUTED).append("\">")
   .append(escape(label)).append("<div style=\"font-size:22px;line-height:1.3;font-weight:700;letter-spacing:0.06em;color:").append(INK).append("\">").append(escape(value)).append("</div></td></tr></table>");
  text.append(label).append(": ").append(value).append("\n");
  return this;
 }
 /** The message's one action. */
 MailLayout button(String label,String url) {
  html.append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:20px 0 8px\"><tr><td bgcolor=\"").append(BLUE).append("\" style=\"border-radius:999px;background:").append(BLUE).append("\">")
   .append("<a href=\"").append(escape(url)).append("\" style=\"display:inline-block;padding:14px 28px;").append(FONT).append("font-size:16px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px\">").append(escape(label)).append("</a></td></tr></table>");
  text.append("\n").append(label).append(": ").append(url).append("\n");
  return this;
 }
 /** A second, quieter destination under the action. */
 MailLayout link(String label,String url) {
  html.append("<p style=\"margin:8px 0 0;").append(FONT).append("font-size:15px;line-height:1.5\"><a href=\"").append(escape(url)).append("\" style=\"color:").append(BLUE).append(";font-weight:600;text-decoration:underline\">").append(escape(label)).append("</a></p>");
  text.append(label).append(": ").append(url).append("\n");
  return this;
 }
 /** The address itself, for clients that do not draw the button. */
 MailLayout fallback(String url) {
  html.append("<p style=\"margin:16px 0 0;").append(FONT).append("font-size:13px;line-height:1.5;color:").append(MUTED).append(";word-break:break-all\">Si el botón no funciona, copia este enlace en tu navegador:<br>").append(escape(url)).append("</p>");
  return this;
 }

 MailMessage build(String subject) {
  String page="<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
   // The sheet is designed light; clients that restyle for dark mode are asked to leave it as drawn.
   +"<meta name=\"color-scheme\" content=\"light only\"><meta name=\"supported-color-schemes\" content=\"light only\"><title>"+escape(subject)+"</title>"
   +"<style>:root{color-scheme:light only}body{margin:0;padding:0}img{border:0}@media (max-width:480px){.sheet{padding:28px 20px !important}.frame{padding:12px 0 !important}h1{font-size:24px !important}}</style></head>"
   +"<body bgcolor=\""+PAPER+"\" style=\"margin:0;padding:0;background:"+PAPER+";color:"+INK+";-webkit-text-size-adjust:100%\">"
   +"<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:"+PAPER+"\">"+escape(preheader)+"</div>"
   +"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" bgcolor=\""+PAPER+"\" style=\"background:"+PAPER+"\"><tr><td align=\"center\" class=\"frame\" style=\"padding:28px 12px\">"
   +"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" bgcolor=\"#ffffff\" style=\"max-width:600px;background:#ffffff;border-radius:16px\"><tr><td class=\"sheet\" style=\"padding:40px 40px 36px\">"
   // The name stays as the image's text, styled, for clients that do not load images.
   +"<div style=\"margin:0 0 28px\"><img src=\""+escape(logoUrl)+"\" width=\"129\" height=\"30\" alt=\"PLIEGO\" style=\"display:block;width:129px;height:30px;border:0;"+FONT+"font-size:26px;line-height:30px;font-weight:800;letter-spacing:-0.04em;color:"+BLUE+"\"></div>"
   +html
   +"</td></tr></table>"
   +"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:600px\"><tr><td align=\"center\" style=\"padding:20px 24px 0;"+FONT+"font-size:12px;line-height:1.6;color:"+MUTED+"\">"
   +"PLIEGO. Libros para mirar el mundo de otra manera.<br>Este es un mensaje automático sobre tu cuenta o tu compra.</td></tr></table>"
   +"</td></tr></table></body></html>";
  return new MailMessage(subject,page,"PLIEGO\n\n"+text.toString().strip()+"\n\nEste es un mensaje automático sobre tu cuenta o tu compra.");
 }

 record Fact(String label,String value,boolean strong,boolean saving) {
  static Fact of(String label,String value) { return new Fact(label,value,false,false); }
  static Fact total(String label,String value) { return new Fact(label,value,true,false); }
  static Fact saving(String label,String value) { return new Fact(label,value,false,true); }
 }
 /** {@code paid}, {@code original} and {@code saving} are already formatted; any of them, the authors, the medium and the cover may be absent. */
 record Item(String title,String authors,String medium,String quantity,String paid,String original,String saving,String coverUrl) {}

 /** "18.50" as the store writes money: "$ 18,50". A value that is not a plain amount is shown as it came. */
 static String money(String amount) {
  if(amount==null||!amount.matches("\\d{1,15}(\\.\\d{1,2})?"))return amount==null?"":amount;
  var symbols=new DecimalFormatSymbols(ES); symbols.setGroupingSeparator('.'); symbols.setDecimalSeparator(',');
  return "$ "+new DecimalFormat("#,##0.00",symbols).format(new BigDecimal(amount));
 }
 static boolean positive(String amount) {
  return amount!=null&&amount.matches("\\d{1,15}(\\.\\d{1,2})?")&&new BigDecimal(amount).signum()>0;
 }
 /** "15.00" as "15 %". */
 static String percent(String rate) {
  if(rate==null||!rate.matches("\\d{1,3}(\\.\\d{1,4})?"))return rate==null?"":rate;
  return new BigDecimal(rate).stripTrailingZeros().toPlainString().replace('.',',')+" %";
 }
 /** A timestamp or a date as "4 de octubre de 2026", in the store's own zone. */
 static String date(String value) {
  try { return OffsetDateTime.parse(value).atZoneSameInstant(STORE_ZONE).format(DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy",ES)); }
  catch(DateTimeParseException | NullPointerException notATimestamp) {
   try { return LocalDate.parse(value).format(DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy",ES)); }
   catch(DateTimeParseException | NullPointerException notADate) { return value==null?"":value; }
  }
 }
 /** A timestamp as "4 de octubre de 2026, 13:25", in the given zone. */
 static String dateTime(String value,ZoneId zone) {
  return OffsetDateTime.parse(value).atZoneSameInstant(zone).format(DateTimeFormatter.ofPattern("d 'de' MMMM 'de' yyyy, HH:mm",ES));
 }
 static String escape(String value) {
  return value.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;");
 }
 /** Keeps an amount ("$ 18,50") on one line in HTML. */
 private static String nonBreaking(String escaped) { return escaped.replace("$ ","$&nbsp;"); }
}
