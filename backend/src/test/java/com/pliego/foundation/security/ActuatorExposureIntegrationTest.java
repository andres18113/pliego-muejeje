package com.pliego.foundation.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;

import com.pliego.modules.catalog.gateway.CatalogGateway;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "server.address=127.0.0.1",
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:1/unused",
        "PLIEGO_ADMIN_EMAIL=admin@example.invalid",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.mail.enabled=false",
        "pliego.billing.enabled=false",
        "pliego.realtime.enabled=false",
        "pliego.home-delivery.scheduler-enabled=false"
})
class ActuatorExposureIntegrationTest {

    @LocalServerPort
    int port;

    @Autowired
    JwtTokenIssuer tokenIssuer;

    @Autowired
    ObjectMapper json;

    @Autowired
    org.springframework.core.env.Environment environment;

    @MockitoBean
    CatalogGateway catalog;

    @MockitoBean(name = "transactionManager")
    PlatformTransactionManager transactions;

    private final HttpClient http = HttpClient.newHttpClient();

    @ParameterizedTest
    @ValueSource(strings = {"/actuator", "/actuator/health", "/actuator/env",
            "/actuator/heapdump", "/actuator/metrics", "/actuator/prometheus"})
    void managementPathsAreUnavailableOnApplicationPort(String path) throws Exception {
        var anonymous = get(path, null);
        assertThat(anonymous.statusCode()).as("anonymous GET %s", path).isEqualTo(401);
        assertThat(anonymous.headers().firstValue("Content-Type").orElse(""))
                .startsWith("application/problem+json");
        assertThat(json.readTree(anonymous.body()).path("code").asText()).isEqualTo("AUTH_REQUIRED");

        for (String role : List.of("CUSTOMER", "ADMIN")) {
            var authenticated = get(path, token(role));
            assertThat(authenticated.statusCode()).as("%s GET %s", role, path).isEqualTo(404);
            assertThat(authenticated.headers().firstValue("Content-Type").orElse(""))
                    .startsWith("application/problem+json");
        }
    }

    @Test
    void managementServerRemainsDisabledWithoutProfile() {
        assertThat(environment.getProperty("management.server.port", Integer.class)).isEqualTo(-1);
        assertThat(environment.getProperty("local.management.port")).isNull();
        assertThat(environment.matchesProfiles("observability")).isFalse();
    }

    @Test
    void publicCatalogRemainsAvailableOnApplicationPort() throws Exception {
        when(catalog.findPublicCategories(any())).thenReturn(List.of());

        var response = get("/api/v1/catalog/categories", null);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json.readTree(response.body()).path("items").isArray()).isTrue();
    }

    private String token(String role) {
        Instant issued = Instant.now();
        return tokenIssuer.issue("1", role, issued, issued.plusSeconds(1800), UUID.randomUUID().toString());
    }

    private HttpResponse<String> get(String path, String token) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        if (token != null) request.header("Authorization", "Bearer " + token);
        return http.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
