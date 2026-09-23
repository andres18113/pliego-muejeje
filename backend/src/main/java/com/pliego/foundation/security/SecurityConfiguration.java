package com.pliego.foundation.security;

import java.util.List;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.boot.web.servlet.FilterRegistrationBean;

import com.pliego.foundation.web.TraceIdFilter;


@Configuration
public class SecurityConfiguration {

    @Bean
    FilterRegistrationBean<TraceIdFilter> traceIdFilterRegistration(TraceIdFilter traceIdFilter) {
        FilterRegistrationBean<TraceIdFilter> registration = new FilterRegistrationBean<>(traceIdFilter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, TraceIdFilter traceIdFilter,
            SecurityProblemWriter problemWriter) throws Exception {
        AuthenticationEntryPoint entryPoint = (request, response, exception) -> {
            boolean missing = request.getHeader(HttpHeaders.AUTHORIZATION) == null;
            if (missing) {
                response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
            } else {
                response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer error=\"invalid_token\"");
            }
            problemWriter.write(request, response,
                    missing ? "AUTH_REQUIRED" : "AUTH_INVALID_TOKEN",
                    missing ? "Autenticación requerida" : "Token inválido",
                    HttpStatus.UNAUTHORIZED,
                    missing ? "Debes iniciar sesión para realizar esta operación."
                            : "El token de acceso no es válido o ha vencido.");
        };
        AccessDeniedHandler deniedHandler = (request, response, exception) -> problemWriter.write(request,
                response, "ACCESS_DENIED", "Acceso denegado", HttpStatus.FORBIDDEN,
                "No tienes permiso para realizar esta operación.");

        http.csrf(AbstractHttpConfigurer::disable)
                .cors(org.springframework.security.config.Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(entryPoint)
                        .accessDeniedHandler(deniedHandler))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/register", "/api/v1/auth/login").permitAll()
                        .requestMatchers("/api/v1/catalog/**").permitAll()
                        .requestMatchers("/v3/api-docs", "/v3/api-docs/**", "/swagger-ui.html", "/swagger-ui/**")
                        .permitAll()
                        .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/me", "/api/v1/me/**", "/api/v1/cart", "/api/v1/cart/**",
                                "/api/v1/checkout", "/api/v1/orders", "/api/v1/orders/**")
                        .hasRole("CUSTOMER")
                        .anyRequest().authenticated())
                .oauth2ResourceServer(resourceServer -> resourceServer
                        .authenticationEntryPoint(entryPoint)
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(token -> toAuthentication(token))));

        http.addFilterBefore(traceIdFilter, CorsFilter.class);
        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${pliego.cors.allowed-origins:}") String configuredOrigins) {
        CorsConfiguration configuration = new CorsConfiguration();
        List<String> origins = configuredOrigins.isBlank()
                ? List.of()
                : java.util.Arrays.stream(configuredOrigins.split(","))
                        .map(String::trim)
                        .filter(origin -> !origin.isEmpty())
                        .toList();
        configuration.setAllowedOrigins(origins);
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        configuration.setExposedHeaders(List.of("X-Trace-Id"));
        configuration.setAllowCredentials(false);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    private JwtAuthenticationToken toAuthentication(Jwt token) {
        String role = token.getClaimAsString("role");
        return new JwtAuthenticationToken(token,
                List.of(new SimpleGrantedAuthority("ROLE_" + role)), token.getSubject());
    }
}
