package com.pliego.foundation.security;

import org.springframework.boot.security.autoconfigure.actuate.web.servlet.EndpointRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.context.ApplicationContext;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.core.env.Environment;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.util.matcher.AndRequestMatcher;

/** Only mapped management endpoints; no application-path allowlist. See ADR0059. */
@Configuration(proxyBeanMethods = false)
@Profile("observability")
public class ObservabilitySecurityConfiguration {

    @Bean
    static BeanFactoryPostProcessor observabilityConfigurationSafety(Environment environment) {
        // Recheck late property sources before any configuration bean can bind
        // an address or start a connector (including Spring test customizers).
        return beanFactory -> ObservabilityEnvironmentPostProcessor.validate(environment);
    }

    @Bean
    ObservabilityManagementBoundary observabilityManagementBoundary(ApplicationContext context) {
        return new ObservabilityManagementBoundary(context);
    }

    @Bean
    @Order(0)
    SecurityFilterChain observabilitySecurityFilterChain(HttpSecurity http,
            ObservabilityManagementBoundary boundary) throws Exception {
        return http.securityMatcher(new AndRequestMatcher(boundary,
                        EndpointRequest.to("health", "metrics", "prometheus")))
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll())
                .build();
    }
}
