package com.pliego.foundation.openapi;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springdoc.core.customizers.OpenApiCustomizer;

@Configuration
public class OpenApiConfiguration {

    @Bean
    OpenAPI pliegoOpenApi() {
        return new OpenAPI()
                .openapi("3.1.2")
                .info(new Info().title("PLIEGO API").version("1.0.0")
                        .description("API de PLIEGO v1. Incluye autenticación, perfil y direcciones del cliente."))
                .components(new Components().addSecuritySchemes("bearerJwt",
                        new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")));
    }

    @Bean
    OpenApiCustomizer approvedOpenApiVersion() {
        return openApi -> openApi.setOpenapi("3.1.2");
    }
}
