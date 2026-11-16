package com.pliego.foundation.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.boot.web.server.servlet.context.ServletWebServerInitializedEvent;
import org.springframework.mock.web.MockHttpServletRequest;

class ObservabilityManagementBoundaryTest {
    @Test
    void onlyInitializedActualManagementPortMatchesRegardlessOfForwarding() {
        try (var app = new ServletWebServerApplicationContext();
             var management = managementContext(app)) {
            var boundary = new ObservabilityManagementBoundary(app);
            var request = new MockHttpServletRequest();
            request.setLocalPort(18081);
            assertThat(boundary.matches(request)).isFalse();

            boundary.onApplicationEvent(event(management, 18081));
            assertThat(boundary.matches(request)).isFalse();
            boundary.onApplicationEvent(event(app, 18080));
            assertThat(boundary.matches(request)).isTrue();

            request.setLocalPort(18080);
            request.setServerPort(18081);
            request.addHeader("X-Forwarded-Port", "18081");
            request.addHeader("Forwarded", "host=localhost:18081;proto=https");
            assertThat(boundary.matches(request)).isFalse();
        }
    }

    @Test
    void unrelatedManagementContextCannotSupplyTheTrustedPort() {
        try (var app = new ServletWebServerApplicationContext();
             var other = new ServletWebServerApplicationContext();
             var management = managementContext(other)) {
            var boundary = new ObservabilityManagementBoundary(app);
            boundary.onApplicationEvent(event(app, 18080));
            boundary.onApplicationEvent(event(management, 18081));
            var request = new MockHttpServletRequest();
            request.setLocalPort(18081);
            assertThat(boundary.matches(request)).isFalse();
        }
    }

    @Test
    void coincidentActualPortsAbortInitializationAndNeverMatch() {
        try (var app = new ServletWebServerApplicationContext();
             var management = managementContext(app)) {
            var boundary = new ObservabilityManagementBoundary(app);
            boundary.onApplicationEvent(event(app, 18080));
            assertThatThrownBy(() -> boundary.onApplicationEvent(event(management, 18080)))
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("observability");
            var request = new MockHttpServletRequest();
            request.setLocalPort(18080);
            assertThat(boundary.matches(request)).isFalse();
        }
    }

    private static ServletWebServerApplicationContext managementContext(ServletWebServerApplicationContext parent) {
        var context = new ServletWebServerApplicationContext();
        context.setParent(parent);
        context.setServerNamespace("management");
        return context;
    }

    private static ServletWebServerInitializedEvent event(ServletWebServerApplicationContext context, int port) {
        return new ServletWebServerInitializedEvent(new WebServer() {
            @Override public void start() {}
            @Override public void stop() {}
            @Override public int getPort() { return port; }
        }, context);
    }
}
