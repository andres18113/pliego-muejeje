package com.pliego.modules.notifications;

import static org.assertj.core.api.Assertions.*;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import com.pliego.modules.notifications.provider.MailtrapWebhook;
import com.pliego.modules.notifications.application.MailtrapWebhookProperties;

class MailtrapWebhookTest {
 static final String SECRET="0123456789abcdef0123456789abcdef";
 static final String BODY="""
  {"events":[{"event":"bounce","event_id":"evt-1","message_id":"msg-1",
  "timestamp":1793547217,"sending_stream":"transactional","response":"private SMTP"}]}
  """;
 static String sign(byte[] body) throws Exception {
  return sign(body,SECRET);
 }
 static String sign(byte[] body,String secret) throws Exception {
  var mac=Mac.getInstance("HmacSHA256");
  mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
  return HexFormat.of().formatHex(mac.doFinal(body));
 }
 @Test void signatureUsesRawBodyAndTextSecret() throws Exception {
  var webhook=new MailtrapWebhook(new MailtrapWebhookProperties(SECRET),new ObjectMapper());
  byte[] bytes=BODY.getBytes(StandardCharsets.UTF_8);
  assertThat(webhook.authentic(bytes,sign(bytes))).isTrue();
  assertThat(webhook.authentic((BODY+" ").getBytes(StandardCharsets.UTF_8),sign(bytes))).isFalse();
  for(String bad:new String[]{"", "00", "g".repeat(64)}) assertThat(webhook.authentic(bytes,bad)).isFalse();
  assertThat(webhook.authentic(bytes,null)).isFalse();
  assertThat(webhook.authentic(bytes,sign(bytes,"abcdef0123456789abcdef0123456789"))).isFalse();
  assertThat(new MailtrapWebhook(new MailtrapWebhookProperties(""),new ObjectMapper()).authentic(bytes,sign(bytes))).isFalse();
 }
 @Test void acceptsFiveHundredEventsAndRejectsLargerBatchAndJsonLines() {
  var webhook=new MailtrapWebhook(new MailtrapWebhookProperties(SECRET),new ObjectMapper());
  String event="{\"event\":\"delivery\",\"event_id\":\"evt-1\",\"message_id\":\"msg-1\",\"timestamp\":1793547217,\"sending_stream\":\"transactional\"}";
  String batch="{\"events\":["+String.join(",",java.util.Collections.nCopies(500,event))+"]}";
  assertThat(webhook.parse(batch.getBytes(StandardCharsets.UTF_8))).hasSize(500);
  String tooMany="["+String.join(",",java.util.Collections.nCopies(501,event))+"]";
  assertThatThrownBy(()->webhook.parse(tooMany.getBytes(StandardCharsets.UTF_8))).isInstanceOf(IllegalArgumentException.class);
  assertThatThrownBy(()->webhook.parse((event+"\n"+event).getBytes(StandardCharsets.UTF_8))).isInstanceOf(IllegalArgumentException.class);
  assertThatThrownBy(()->webhook.parse((BODY+"\n"+BODY).getBytes(StandardCharsets.UTF_8))).isInstanceOf(IllegalArgumentException.class);
 }
 @Test void parserStoresOnlySafeOutcomes() {
  var webhook=new MailtrapWebhook(new MailtrapWebhookProperties(SECRET),new ObjectMapper());
  var event=webhook.parse(BODY.getBytes(StandardCharsets.UTF_8)).getFirst();
  assertThat(event.status()).isEqualTo("BOUNCED");
  assertThat(event.reason()).isEqualTo("HARD_BOUNCE");
  assertThat(event.toString()).doesNotContain("private SMTP");
  assertThat(webhook.parse(BODY.replace("bounce","soft bounce").getBytes(StandardCharsets.UTF_8)).getFirst().reason()).isNull();
  String reject=BODY.replace("\"bounce\"","\"reject\"").replace("\"response\":\"private SMTP\"","\"reason\":\"Recipient in suppression list. Reason: hard bounce\"");
  assertThat(webhook.parse(reject.getBytes(StandardCharsets.UTF_8)).getFirst().status()).isEqualTo("SUPPRESSED");
  assertThat(webhook.parse(reject.replace("Recipient in suppression list. Reason: hard bounce","Domain not verified").getBytes(StandardCharsets.UTF_8)).getFirst().reason()).isNull();
  assertThat(webhook.parse(BODY.replace("transactional","bulk").getBytes(StandardCharsets.UTF_8))).isEmpty();
  assertThatThrownBy(()->webhook.parse("{}".getBytes(StandardCharsets.UTF_8))).isInstanceOf(IllegalArgumentException.class);
  assertThatThrownBy(()->webhook.parse(BODY.replace("evt-1","bad id").getBytes(StandardCharsets.UTF_8))).isInstanceOf(IllegalArgumentException.class);
 }
 @Test void secretIsValidatedAndRedacted() {
  assertThat(new MailtrapWebhookProperties(SECRET).toString()).doesNotContain(SECRET);
  assertThatThrownBy(()->new MailtrapWebhookProperties("invalid")).isInstanceOf(IllegalArgumentException.class);
 }
}
