package com.pliego.foundation.security;

import java.net.InetAddress;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

/** Reject unsafe overrides before framework address binding or connector startup. */
public final class ObservabilityEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    @Override
    public int getOrder() {
        return ConfigDataEnvironmentPostProcessor.ORDER + 1;
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        validate(environment);
    }

    static void validate(Environment environment) {
        if (!environment.acceptsProfiles(Profiles.of("observability"))) return;

        String rawManagementPort = environment.getProperty("management.server.port");
        if (rawManagementPort == null || rawManagementPort.isBlank()) {
            throw invalid("un management.server.port explícito y habilitado.");
        }
        int managementPort = port(rawManagementPort);
        if (managementPort < 0 || managementPort > 65535) {
            throw invalid("management.server.port entre 0 y 65535.");
        }
        int applicationPort = port(environment.getProperty("server.port", "8080"));
        if (managementPort == applicationPort) {
            throw invalid("puertos configurados distintos para la aplicación y la gestión.");
        }

        String address = environment.getProperty("management.server.address");
        if (address == null || address.isBlank()) {
            throw invalid("una dirección loopback literal en management.server.address.");
        }
        // Literal parsing never queries DNS for an operator-supplied hostname.
        try {
            if (!InetAddress.ofLiteral(address).isLoopbackAddress()) {
                throw invalid("una dirección loopback literal en management.server.address.");
            }
        } catch (IllegalArgumentException exception) {
            throw invalid("una dirección loopback literal en management.server.address.");
        }
    }

    private static int port(String value) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException exception) {
            throw invalid("puertos numéricos válidos para la aplicación y la gestión.");
        }
    }

    private static IllegalStateException invalid(String detail) {
        return new IllegalStateException("El perfil observability requiere " + detail);
    }
}
