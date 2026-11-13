package com.pliego.foundation.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.endpoint.web.WebEndpointsSupplier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;

import com.pliego.modules.catalog.gateway.CatalogGateway;
import com.pliego.PliegoApplication;

import io.micrometer.core.instrument.MeterRegistry;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "server.address=127.0.0.1",
        "management.health.db.enabled=false",
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:1/unused",
        "PLIEGO_ADMIN_EMAIL=admin@example.invalid",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.mail.enabled=false",
        "pliego.r2.enabled=false",
        "pliego.billing.enabled=false",
        "pliego.realtime.enabled=false",
        "pliego.home-delivery.scheduler-enabled=false"
})
@ActiveProfiles("observability")
class ObservabilityProfileIntegrationTest {
    @DynamicPropertySource
    static void distinctConfiguredManagementPort(DynamicPropertyRegistry properties) throws Exception {
        int port = freeLoopbackPort();
        properties.add("management.server.port", () -> port);
    }

    private static int freeLoopbackPort() throws java.io.IOException {
        try (var socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            return socket.getLocalPort();
        }
    }
    @LocalServerPort int applicationPort;
    @Value("${local.management.port}") int managementPort;
    @Autowired Environment environment;
    @Autowired WebEndpointsSupplier endpoints;
    @Autowired JwtTokenIssuer tokenIssuer;
    @Autowired ObjectMapper json;
    @Autowired MeterRegistry registry;
    @MockitoBean CatalogGateway catalog;
    @MockitoBean(name = "transactionManager") PlatformTransactionManager transactions;
    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void managementIsLoopbackOnlyAndOnlyThreeReadEndpointsExist() throws Exception {
        assertThat(managementPort).isNotEqualTo(applicationPort).isPositive();
        assertThat(environment.getProperty("management.server.address")).isEqualTo("127.0.0.1");
        assertThat(environment.getProperty("server.tomcat.mbeanregistry.enabled", Boolean.class)).isTrue();
        assertThat(endpoints.getEndpoints()).extracting(endpoint -> endpoint.getEndpointId().toString())
                .containsExactlyInAnyOrder("health", "metrics", "prometheus");

        var health = get(managementPort, "/actuator/health", null);
        assertThat(health.statusCode()).isEqualTo(200);
        assertThat(json.readTree(health.body()).propertyNames()).contains("status").doesNotContain("details", "components");
        assertThat(get(managementPort, "/actuator/metrics", null).statusCode()).isEqualTo(200);
        var scrape = get(managementPort, "/actuator/prometheus", null);
        assertThat(scrape.statusCode()).isEqualTo(200);
        assertThat(scrape.body()).contains("jvm_memory_used_bytes", "pliego_sse_active");

        String admin = token("ADMIN");
        for (String endpoint : List.of("env", "heapdump", "threaddump", "beans", "configprops", "loggers", "mappings", "shutdown")) {
            assertThat(get(managementPort, "/actuator/" + endpoint, admin).statusCode())
                    .as("disabled management endpoint %s", endpoint).isEqualTo(404);
        }
        assertThat(get(managementPort, "/actuator", admin).statusCode()).isEqualTo(404);
        var post = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + managementPort + "/actuator/shutdown"))
                .header("Authorization", "Bearer " + admin).POST(HttpRequest.BodyPublishers.noBody()).build();
        assertThat(http.send(post, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(404);
        System.out.println("OBSERVABILITY evidence: application=" + applicationPort + " management=" + managementPort
                + " address=127.0.0.1 endpoints=health,metrics,prometheus health=" + health.body());
    }

    @Test
    void tomcatThreadMetersArePresentInFreshProfileProcess(@org.junit.jupiter.api.io.TempDir Path temporary) throws Exception {
        // Tomcat's disabled registry is a JVM singleton: another test's default
        // context can permanently disable it before this profile starts. A new
        // process tests the same startup contract as an actual profile restart.
        var command = new ArrayList<>(List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"), TomcatMetricProbe.class.getName()));
        var output = temporary.resolve("tomcat-probe.log");
        var builder = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(output.toFile());
        builder.environment().keySet().removeIf(key -> key.startsWith("PLIEGO_MAILTRAP_") || key.startsWith("PLIEGO_R2_"));
        var process = builder.start();
        try {
            assertThat(process.waitFor(45, TimeUnit.SECONDS)).as("fresh profile JVM completes").isTrue();
            var log = Files.readString(output);
            System.out.println(log);
            System.out.println("OBSERVABILITY fresh-process exit_status=" + process.exitValue());
            assertThat(process.exitValue()).as(log).isZero();
            assertThat(log).contains("OBSERVABILITY fresh-process tomcat_threads_busy_threads=present");
        } finally { process.destroyForcibly(); }
    }

    public static class TomcatMetricProbe {
        public static void main(String[] args) throws Exception {
            try (var context = new SpringApplicationBuilder(PliegoApplication.class).run(
                    "--spring.profiles.active=observability", "--server.address=127.0.0.1", "--server.port=0",
                    "--management.server.port=" + freeLoopbackPort(), "--management.health.db.enabled=false",
                    "--spring.flyway.enabled=false", "--spring.datasource.url=jdbc:postgresql://127.0.0.1:1/unused",
                    "--spring.datasource.username=synthetic", "--spring.datasource.password=synthetic",
                    "--PLIEGO_ADMIN_EMAIL=admin@example.invalid", "--PLIEGO_ADMIN_PASSWORD_HASH=unused",
                    "--PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
                    "--pliego.mail.enabled=false", "--pliego.r2.enabled=false", "--pliego.billing.enabled=false",
                    "--pliego.realtime.enabled=false", "--pliego.home-delivery.scheduler-enabled=false",
                    "--pliego.offers.scheduler-enabled=false")) {
                int port = context.getEnvironment().getRequiredProperty("local.management.port", Integer.class);
                var response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
                        URI.create("http://127.0.0.1:" + port + "/actuator/prometheus")).GET().build(),
                        HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200 || !response.body().contains("tomcat_threads_busy_threads")) {
                    throw new IllegalStateException("El proceso nuevo no expone métricas de hilos de Tomcat.");
                }
                System.out.println("OBSERVABILITY fresh-process tomcat_threads_busy_threads=present management=" + port);
            }
        }
    }

    @Test
    void applicationConnectorDoesNotExposeManagementWithProfileOn() throws Exception {
        for (String path : List.of("/actuator", "/actuator/health", "/actuator/metrics", "/actuator/prometheus")) {
            assertThat(get(applicationPort, path, null).statusCode()).as("anonymous %s", path).isEqualTo(401);
            assertThat(get(applicationPort, path, token("ADMIN")).statusCode()).as("admin %s", path).isEqualTo(404);
        }
        var forwardedPort = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + applicationPort + "/actuator/health"))
                .header("X-Forwarded-Port", Integer.toString(managementPort))
                .header("X-Forwarded-Host", "localhost")
                .header("X-Forwarded-Proto", "https").GET().build();
        assertThat(http.send(forwardedPort, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(401);
    }

    @Test
    void httpRequestUriTagsCollapseUnknownPathsAndTemplatePathVariables() throws Exception {
        for (int n = 0; n < 12; n++) {
            assertThat(get(applicationPort, "/api/v1/catalog/unknown-sensitive-" + n, null).statusCode()).isEqualTo(404);
            // Missing synthetic editions still resolve the controller's URI template.
            get(applicationPort, "/api/v1/catalog/editions/" + (98765000 + n), null);
        }
        var timers = registry.find("http.server.requests").timers();
        assertThat(timers).isNotEmpty();
        var uriTags = timers.stream().map(timer -> timer.getId().getTag("uri")).distinct().toList();
        // Boot 4.1 MVC's static-resource catch-all maps missing resources to /**.
        assertThat(uriTags).contains("/**", "/api/v1/catalog/editions/{editionId}");
        assertThat(uriTags).noneMatch(uri -> uri.contains("sensitive") || uri.contains("98765"));
        var unknown = timers.stream().filter(timer -> "/**".equals(timer.getId().getTag("uri")))
                .mapToLong(timer -> timer.count()).sum();
        assertThat(unknown).isGreaterThanOrEqualTo(12);

        var scrape = get(managementPort, "/actuator/prometheus", null).body();
        assertThat(scrape).contains("http_server_requests_seconds_bucket", "le=\"0.1\"", "le=\"0.3\"",
                "le=\"0.8\"", "le=\"1.5\"", "le=\"3.0\"");
        var buckets = scrape.lines().filter(line -> line.startsWith("http_server_requests_seconds_bucket"))
                .map(line -> line.substring(line.indexOf("le=\"") + 4).split("\"")[0]).distinct().toList();
        assertThat(buckets).containsExactlyInAnyOrder("0.1", "0.3", "0.8", "1.5", "3.0", "+Inf");
        System.out.println("OBSERVABILITY evidence: uriTags=" + uriTags + " unknownPathCount=" + unknown + " sloBuckets=" + buckets);
    }

    private String token(String role) {
        Instant issued = Instant.now();
        return tokenIssuer.issue("1", role, issued, issued.plusSeconds(1800), UUID.randomUUID().toString());
    }

    private HttpResponse<String> get(int port, String path, String token) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        if (token != null) request.header("Authorization", "Bearer " + token);
        return http.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
