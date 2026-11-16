package com.pliego.modules.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import java.util.UUID;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import com.pliego.modules.realtime.gateway.RealtimeGateway;

@SpringBootTest(properties={"spring.flyway.enabled=false", "spring.datasource.url=jdbc:postgresql://127.0.0.1:1/unused",
 "PLIEGO_ADMIN_EMAIL=admin@example.invalid","PLIEGO_ADMIN_PASSWORD_HASH=unused",
 "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef", "pliego.realtime.enabled=false",
 "pliego.home-delivery.scheduler-enabled=false","pliego.billing.enabled=false","pliego.mail.enabled=false"})
@AutoConfigureMockMvc
class RealtimeControllerTest {
 @Autowired MockMvc mvc;
 @MockitoBean RealtimeGateway gateway;
 @MockitoBean(name="transactionManager") org.springframework.transaction.PlatformTransactionManager transactions;

 @Test void anonymousAndBearerOnlyCannotOpenCookieStream() throws Exception {
  mvc.perform(get("/api/v1/auth/events")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
  mvc.perform(get("/api/v1/auth/events").header("Authorization","Bearer invalid")).andExpect(status().isUnauthorized());
  verifyNoInteractions(gateway);
 }
 @Test void invalidCookieAndConnectionCapReturnSpanishProblems() throws Exception {
  when(gateway.connect(anyString(),any())).thenReturn("UNAUTHORIZED","LIMITED");
  mvc.perform(get("/api/v1/auth/events").cookie(cookie())).andExpect(status().isUnauthorized());
  mvc.perform(get("/api/v1/auth/events").cookie(cookie())).andExpect(status().isTooManyRequests())
   .andExpect(header().string("Retry-After","60")).andExpect(jsonPath("$.code").value("REALTIME_CONNECTION_LIMITED"));
 }
 @Test void invalidResumeCursorIsRejectedBeforeOpeningLease() throws Exception {
  for(String cursor:List.of("-1","bad","9223372036854775808")) {
   mvc.perform(get("/api/v1/auth/events").cookie(cookie()).header("Last-Event-ID",cursor))
    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
  }
  verifyNoInteractions(gateway);
 }
 @Test void streamSendsRetryHeartbeatAndResyncWithProxyHeaders() throws Exception {
  when(gateway.connect(anyString(),any())).thenReturn("CONNECTED");
  when(gateway.read(any(),isNull())).thenAnswer(call->{
   assertThat(Thread.currentThread().isVirtual()).isTrue();
   return new RealtimeGateway.Batch(true,"8",true,List.of());
  });
  var result=mvc.perform(get("/api/v1/auth/events").cookie(cookie()))
   .andExpect(request().asyncStarted()).andExpect(header().string("Cache-Control","no-cache"))
   .andExpect(header().string("X-Accel-Buffering","no")).andReturn();
  long deadline=System.nanoTime()+java.time.Duration.ofSeconds(3).toNanos();
  while(!result.getResponse().getContentAsString().contains("event:resync") && System.nanoTime()<deadline) Thread.sleep(10);
  String wire=result.getResponse().getContentAsString();
  assertThat(wire).contains("retry:3000",":heartbeat","id:8","event:resync").doesNotContain("pliego_session");
 }
 private Cookie cookie(){return new Cookie("pliego_session","a".repeat(43));}
}
