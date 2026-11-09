package com.pliego.foundation.security;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.web.server.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.security.web.util.matcher.RequestMatcher;

/** Uses initialized connector ports, never overrideable local.* configuration. */
final class ObservabilityManagementBoundary implements RequestMatcher, ApplicationListener<WebServerInitializedEvent> {
    private final ApplicationContext applicationContext;
    private volatile int applicationPort = -1;
    private volatile int managementPort = -1;

    ObservabilityManagementBoundary(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    @Override
    public void onApplicationEvent(WebServerInitializedEvent event) {
        var context = event.getApplicationContext();
        if (context == applicationContext) {
            applicationPort = event.getWebServer().getPort();
        } else if ("management".equals(context.getServerNamespace())
                && context.getParent() == applicationContext) {
            managementPort = event.getWebServer().getPort();
        }
        if (applicationPort > 0 && applicationPort == managementPort) {
            throw new IllegalStateException("El perfil observability requiere conectores de gestión y aplicación distintos.");
        }
    }

    @Override
    public boolean matches(HttpServletRequest request) {
        return applicationPort > 0 && managementPort > 0 && managementPort != applicationPort
                && request.getLocalPort() == managementPort;
    }
}
