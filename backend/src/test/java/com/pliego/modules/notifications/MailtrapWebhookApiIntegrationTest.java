package com.pliego.modules.notifications;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import com.pliego.modules.notifications.application.MailEventService;

@SpringBootTest(properties={"spring.flyway.enabled=false","spring.datasource.url=jdbc:postgresql://localhost:5432/unused",
 "PLIEGO_ADMIN_EMAIL=admin@example.invalid","PLIEGO_ADMIN_PASSWORD_HASH=unused",
 "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef"})
@TestPropertySource(properties={"pliego.mail.enabled=false","pliego.billing.enabled=false",
 "pliego.home-delivery.scheduler-enabled=false","pliego.r2.enabled=false",
 "pliego.mail.webhook.secret=0123456789abcdef0123456789abcdef"})
@AutoConfigureMockMvc
class MailtrapWebhookApiIntegrationTest {
 @Autowired MockMvc mvc;
 @MockitoBean MailEventService service;
 @BeforeEach void resetService() {reset(service);}
 @Test void webhookAuthenticatesWithoutCustomerJwtAndAcknowledgesAfterStorage() throws Exception {
  byte[] body=MailtrapWebhookTest.BODY.getBytes(StandardCharsets.UTF_8);
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(body)
   .header("Mailtrap-Signature",MailtrapWebhookTest.sign(body)))
   .andExpect(status().isOk());
  var captor=org.mockito.ArgumentCaptor.forClass(java.util.List.class);
  verify(service).record(captor.capture());
  assertThat(captor.getValue()).hasSize(1);
 }
 @Test void missingForgedAndTamperedSignaturesNeverReachStorage() throws Exception {
  byte[] body=MailtrapWebhookTest.BODY.getBytes(StandardCharsets.UTF_8);
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(body))
   .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("MAIL_WEBHOOK_INVALID_SIGNATURE"));
  for(String signature:new String[]{"", "00", "g".repeat(64), "0".repeat(64),MailtrapWebhookTest.sign(body,"abcdef0123456789abcdef0123456789"),MailtrapWebhookTest.sign("{}".getBytes(StandardCharsets.UTF_8))}) {
   mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(body)
    .header("Mailtrap-Signature",signature)).andExpect(status().isUnauthorized())
    .andExpect(jsonPath("$.code").value("MAIL_WEBHOOK_INVALID_SIGNATURE"));
  }
  verifyNoInteractions(service);
 }
 @Test void changedBodyAfterSigningNeverReachesStorage() throws Exception {
  byte[] original=MailtrapWebhookTest.BODY.getBytes(StandardCharsets.UTF_8);
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json")
   .content((MailtrapWebhookTest.BODY+" ").getBytes(StandardCharsets.UTF_8))
   .header("Mailtrap-Signature",MailtrapWebhookTest.sign(original)))
   .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("MAIL_WEBHOOK_INVALID_SIGNATURE"));
  verifyNoInteractions(service);
 }
 @Test void acceptsFiveHundredEventsAndIgnoresBulkStream() throws Exception {
  String event="{\"event\":\"delivery\",\"event_id\":\"evt-%d\",\"message_id\":\"msg-%d\",\"timestamp\":1793547217,\"sending_stream\":\"transactional\"}";
  String batch="{\"events\":["+java.util.stream.IntStream.range(0,500).mapToObj(i->event.formatted(i,i)).collect(java.util.stream.Collectors.joining(","))+"]}";
  byte[] body=batch.getBytes(StandardCharsets.UTF_8);
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(body)
   .header("Mailtrap-Signature",MailtrapWebhookTest.sign(body))).andExpect(status().isOk());
  var captor=org.mockito.ArgumentCaptor.forClass(java.util.List.class);
  verify(service).record(captor.capture());
  assertThat(captor.getValue()).hasSize(500);
  reset(service);
  byte[] bulk=MailtrapWebhookTest.BODY.replace("transactional","bulk").getBytes(StandardCharsets.UTF_8);
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(bulk)
   .header("Mailtrap-Signature",MailtrapWebhookTest.sign(bulk))).andExpect(status().isOk());
  verify(service).record(java.util.List.of());
 }
 @Test void rejectsAuthenticatedJsonLines() throws Exception {
  byte[] body=(MailtrapWebhookTest.BODY+"\n"+MailtrapWebhookTest.BODY).getBytes(StandardCharsets.UTF_8);
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(body)
   .header("Mailtrap-Signature",MailtrapWebhookTest.sign(body)))
   .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MAIL_WEBHOOK_INVALID_PAYLOAD"));
  verifyNoInteractions(service);
 }
 @Test void authenticatedMalformedPayloadIsSpanishBadRequestAndOversizedIsBounded() throws Exception {
  byte[] body="{}".getBytes(StandardCharsets.UTF_8);
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(body)
   .header("Mailtrap-Signature",MailtrapWebhookTest.sign(body)))
   .andExpect(status().isBadRequest()).andExpect(jsonPath("$.detail").value("El lote de eventos no es válido."));
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(new byte[1_048_577]))
   .andExpect(status().is(413));
  verifyNoInteractions(service);
 }
 @Test void storageFailureIsNotAcknowledgedAndConflictingReplayIsExplicit() throws Exception {
  byte[] body=MailtrapWebhookTest.BODY.getBytes(StandardCharsets.UTF_8);
  when(service.record(anyList())).thenThrow(new IllegalStateException("private database failure"));
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(body)
   .header("Mailtrap-Signature",MailtrapWebhookTest.sign(body))).andExpect(status().isInternalServerError())
   .andExpect(jsonPath("$.detail").value("Ocurrió un error interno. Intenta nuevamente."));
  doThrow(new MailEventService.ConflictingEventException()).when(service).record(anyList());
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content(body)
   .header("Mailtrap-Signature",MailtrapWebhookTest.sign(body))).andExpect(status().isConflict())
   .andExpect(jsonPath("$.code").value("MAIL_WEBHOOK_EVENT_CONFLICT"));
 }
}
