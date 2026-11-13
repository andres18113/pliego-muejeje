package com.pliego.foundation.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.stream.Stream;
import java.util.Map;

import com.pliego.PliegoApplication;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;

/** Real Boot startup, without DB/HTTP side effects for invalid-binding cases. */
class ObservabilityStartupSafetyTest {
    @ParameterizedTest(name = "{0}")
    @MethodSource("unsafeSettings")
    void unsafeManagementBindingFailsBeforeContextStartup(String reason, String[] settings) {
        assertThatThrownBy(() -> {
            try (var ignored = probe("observability").run(settings)) {
                // The guard must reject before creating the application context.
            }
        }).as(reason).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("observability");
    }

    static Stream<Arguments> unsafeSettings() {
        return Stream.of(
                invalid("missing management port", "--management.server.address=127.0.0.1"),
                invalid("disabled management port", "--management.server.port=-1", "--management.server.address=127.0.0.1"),
                invalid("same configured ports", "--server.port=18080", "--management.server.port=18080", "--management.server.address=127.0.0.1"),
                invalid("both random configured ports", "--server.port=0", "--management.server.port=0", "--management.server.address=127.0.0.1"),
                invalid("wildcard IPv4", "--management.server.port=18081", "--management.server.address=0.0.0.0"),
                invalid("wildcard IPv6", "--management.server.port=18081", "--management.server.address=::"),
                invalid("non-loopback IPv4", "--management.server.port=18081", "--management.server.address=192.0.2.10"),
                invalid("non-loopback IPv6", "--management.server.port=18081", "--management.server.address=2001:db8::10"),
                invalid("missing management address", "--management.server.port=18081"),
                invalid("blank management address", "--management.server.port=18081", "--management.server.address="),
                invalid("untrusted DNS name", "--management.server.port=18081", "--management.server.address=metrics.example.invalid"),
                invalid("localhost is not a literal", "--management.server.port=18081", "--management.server.address=localhost"),
                invalid("invalid management port", "--management.server.port=65536", "--management.server.address=127.0.0.1")
        );
    }

    private static Arguments invalid(String reason, String... settings) {
        return Arguments.of(reason, settings);
    }

    @Test
    void safeLoopbackAndOneRandomPortAreAccepted() {
        for (String[] settings : new String[][] {
                {"--server.port=0", "--management.server.port=18081", "--management.server.address=127.0.0.1"},
                {"--server.port=18080", "--management.server.port=0", "--management.server.address=::1"}
        }) {
            try (var context = probe("observability").run(settings)) {
                assertThat(context.isActive()).isTrue();
            }
        }
    }

    @Test
    void inactiveProfileDoesNotApplyTheObservabilityGuard() {
        try (var context = probe("default").run("--server.port=0", "--management.server.port=0",
                "--management.server.address=0.0.0.0")) {
            assertThat(context.isActive()).isTrue();
        }
    }

    @Test
    void environmentVariablesBindAndUnsafeOverrideFailsStartup() {
        var environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new SystemEnvironmentPropertySource("synthetic-env", Map.of(
                "MANAGEMENT_SERVER_PORT", "18081", "SERVER_PORT", "18080",
                "MANAGEMENT_SERVER_ADDRESS", "127.0.0.1")));
        try (var context = probe("observability").environment(environment).run()) {
            assertThat(context.isActive()).isTrue();
        }
        environment.getPropertySources().addFirst(new SystemEnvironmentPropertySource("unsafe-env", Map.of(
                "MANAGEMENT_SERVER_ADDRESS", "0.0.0.0")));
        assertThatThrownBy(() -> {
            try (var ignored = probe("observability").environment(environment).run()) {}
        }).isInstanceOf(IllegalStateException.class).hasMessageContaining("observability");
    }

    @ParameterizedTest
    @MethodSource("lateUnsafeSettings")
    void latePropertySourcesCannotBypassTheGuard(String key, String value) {
        assertThatThrownBy(() -> {
            try (var ignored = new SpringApplicationBuilder(LateOverrideProbe.class).web(WebApplicationType.NONE)
                    .profiles("observability")
                    .initializers(context -> context.getEnvironment().getPropertySources()
                            .addFirst(new MapPropertySource("late-override", Map.of(key, value))))
                    .run("--server.port=18080", "--management.server.port=18081", "--management.server.address=127.0.0.1")) {}
        }).isInstanceOf(IllegalStateException.class).hasMessageContaining("observability");
    }

    static Stream<Arguments> lateUnsafeSettings() {
        return Stream.of(Arguments.of("management.server.port", "18080"),
                Arguments.of("management.server.address", "metrics.example.invalid"));
    }

    @Test
    void sameConnectorCannotStartAndExposeAnonymousManagement() throws Exception {
        // All actual listening remains local in the pre-fix reproducer.
        int samePort;
        try (var socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            samePort = socket.getLocalPort();
        }
        assertThatThrownBy(() -> {
            try (var context = new SpringApplicationBuilder(PliegoApplication.class).run(
                    "--spring.config.location=optional:classpath:/observability-safety-empty.properties",
                    "--spring.profiles.active=observability", "--server.address=127.0.0.1", "--server.port=" + samePort,
                    "--management.server.port=" + samePort, "--management.health.db.enabled=false",
                    "--management.endpoints.web.exposure.include=health,metrics,prometheus",
                    "--spring.flyway.enabled=false", "--spring.datasource.url=jdbc:postgresql://127.0.0.1:1/unused",
                    "--spring.datasource.username=synthetic", "--spring.datasource.password=synthetic",
                    "--PLIEGO_ADMIN_EMAIL=admin@example.invalid", "--PLIEGO_ADMIN_PASSWORD_HASH=unused",
                    "--PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
                    "--pliego.security.jwt.secret=0123456789abcdef0123456789abcdef",
                    "--pliego.mail.token-secret=0123456789abcdef0123456789abcdef",
                    "--pliego.checkout.transfer.bank=Sintético", "--pliego.checkout.transfer.beneficiary=Sintético",
                    "--pliego.checkout.transfer.account-type=Local", "--pliego.checkout.transfer.account-number=0000000000",
                    "--pliego.checkout.transfer.identification=0000000000000",
                    "--pliego.mail.enabled=false", "--pliego.r2.enabled=false", "--pliego.billing.enabled=false",
                    "--pliego.realtime.enabled=false", "--pliego.home-delivery.scheduler-enabled=false",
                    "--pliego.offers.scheduler-enabled=false")) {
                int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);
                var response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
                        URI.create("http://127.0.0.1:" + port + "/actuator/health")).GET().build(),
                        HttpResponse.BodyHandlers.ofString());
                System.out.println("OBSERVABILITY pre-fix same-connector anonymous health=" + response.statusCode());
            }
        }).isInstanceOf(IllegalStateException.class).hasMessageContaining("observability");
    }

    private static SpringApplicationBuilder probe(String profile) {
        return new SpringApplicationBuilder(Probe.class).web(WebApplicationType.NONE).profiles(profile)
                .properties("spring.config.location=optional:classpath:/observability-safety-empty.properties",
                        "spring.main.banner-mode=off", "logging.level.root=OFF");
    }

    @Configuration(proxyBeanMethods = false)
    static class Probe {}

    @Configuration(proxyBeanMethods = false)
    @Import(ObservabilitySecurityConfiguration.class)
    static class LateOverrideProbe {}
}
