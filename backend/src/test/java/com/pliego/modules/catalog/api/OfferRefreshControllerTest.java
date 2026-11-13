package com.pliego.modules.catalog.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import com.pliego.foundation.security.AuthSessionRequestFilter;
import com.pliego.foundation.security.SecurityConfiguration;
import com.pliego.foundation.security.SecurityProblemWriter;
import com.pliego.foundation.web.ApiExceptionHandler;
import com.pliego.foundation.web.ProblemDetailFactory;
import com.pliego.foundation.web.TraceIdFilter;
import com.pliego.modules.catalog.application.OfferLifecycleService;
import com.pliego.modules.catalog.application.OfferRefreshClock;
import com.pliego.modules.catalog.gateway.OfferLifecycleGateway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

@WebMvcTest(OfferRefreshController.class)
@Import({OfferLifecycleService.class, SecurityConfiguration.class, SecurityProblemWriter.class,
        AuthSessionRequestFilter.class, TraceIdFilter.class, ApiExceptionHandler.class, ProblemDetailFactory.class,
        OfferRefreshControllerTest.SecurityTestConfiguration.class})
class OfferRefreshControllerTest {
    @TestConfiguration(proxyBeanMethods = false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    static class SecurityTestConfiguration { }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @MockitoBean OfferLifecycleGateway gateway;
    @MockitoBean JwtDecoder decoder;

    @Test
    void anonymousClock_isNotCached_andContainsOnlyPublicTimingMetadata() throws Exception {
        when(gateway.clock()).thenReturn(new OfferRefreshClock(Instant.parse("2026-11-04T12:00:00Z"),
                Instant.parse("2026-11-04T12:00:10Z"), 60));

        var result = mvc.perform(get("/api/v1/catalog/offer-refresh"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.serverTime").value("2026-11-04T12:00:00Z"))
                .andExpect(jsonPath("$.nextTransitionAt").value("2026-11-04T12:00:10Z"))
                .andExpect(jsonPath("$.revalidateAfterSeconds").value(60)).andReturn();
        assertThat(mapper.readTree(result.getResponse().getContentAsString()).size()).isEqualTo(3);
    }

    @Test
    void noFutureTransition_retainsAnExplicitNullDeadline() throws Exception {
        when(gateway.clock()).thenReturn(new OfferRefreshClock(Instant.parse("2026-11-04T12:00:00Z"), null, 60));
        var result = mvc.perform(get("/api/v1/catalog/offer-refresh"))
                .andExpect(status().isOk()).andReturn();
        var response = mapper.readTree(result.getResponse().getContentAsString());
        assertThat(response.has("nextTransitionAt")).isTrue();
        assertThat(response.get("nextTransitionAt").isNull()).isTrue();
    }
}
