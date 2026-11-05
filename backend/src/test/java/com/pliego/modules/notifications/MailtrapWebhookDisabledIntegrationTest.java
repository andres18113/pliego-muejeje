package com.pliego.modules.notifications;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
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
 "pliego.home-delivery.scheduler-enabled=false","pliego.r2.enabled=false","pliego.mail.webhook.secret="})
@AutoConfigureMockMvc
class MailtrapWebhookDisabledIntegrationTest {
 @Autowired MockMvc mvc;
 @MockitoBean MailEventService service;
 @Test void missingSecretDisablesIngestionEvenWithSignature() throws Exception {
  mvc.perform(post("/api/v1/webhooks/mailtrap").contentType("application/json").content("{}")
   .header("Mailtrap-Signature","0".repeat(64))).andExpect(status().isNotFound());
  verifyNoInteractions(service);
 }
}
