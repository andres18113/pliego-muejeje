package com.pliego.foundation.openapi;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;

import com.pliego.modules.catalog.gateway.CatalogGateway;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "server.address=127.0.0.1",
        // Load the shipped YAML without the test-only application.properties.
        // Profile includes are additive across property sources, even if blank.
        "spring.config.location=classpath:application.yml",
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:1/unused",
        "PLIEGO_ADMIN_EMAIL=admin@example.invalid",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.mail.enabled=false",
        "pliego.billing.enabled=false",
        "pliego.offers.scheduler-enabled=false",
        "pliego.realtime.enabled=false",
        "pliego.home-delivery.scheduler-enabled=false"
})
abstract class OpenApiHttpTestSupport {
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired org.springframework.core.env.Environment environment;
    @MockitoBean CatalogGateway catalog;
    @MockitoBean(name = "transactionManager") PlatformTransactionManager transactions;
    private final HttpClient http = HttpClient.newHttpClient();

    HttpResponse<String> get(String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
