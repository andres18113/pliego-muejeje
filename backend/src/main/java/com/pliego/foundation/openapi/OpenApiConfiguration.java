package com.pliego.foundation.openapi;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import org.springdoc.core.customizers.OpenApiCustomizer;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.ComposedSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.security.SecurityScheme;

@Configuration
public class OpenApiConfiguration {

    @Bean
    OpenAPI pliegoOpenApi() {
        return new OpenAPI()
                .openapi("3.1.2")
                .info(new Info().title("PLIEGO API").version("1.0.0")
                        .description("API de PLIEGO v1: autenticación, clientes, catálogo, inventario, carrito, pago y pedidos."))
                .components(new Components().addSecuritySchemes("bearerJwt",
                        new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT"))
                        .addSecuritySchemes("authSessionCookie",
                                new SecurityScheme().type(SecurityScheme.Type.APIKEY)
                                        .in(SecurityScheme.In.COOKIE).name("pliego_session"))
                        .addSecuritySchemes("registrationContinuationCookie",
                                new SecurityScheme().type(SecurityScheme.Type.APIKEY)
                                        .in(SecurityScheme.In.COOKIE).name("pliego_registration")));
    }

    @Bean
    OpenApiCustomizer pendingEmailNullableContract() {
        return openApi -> {
            var profile = openApi.getComponents().getSchemas().get("CustomerProfile");
            if (profile != null && profile.getProperties() != null) {
                // A nullable $ref sibling is ignored by some 3.1 clients. Model the union explicitly.
                var pending = new ComposedSchema()
                        .addAnyOfItem(new Schema<>().$ref("#/components/schemas/PendingEmail"))
                        .addAnyOfItem(new Schema<>().types(java.util.Set.of("null")))
                        .description("Cambio de correo vigente; null cuando no existe o venció.");
                profile.addProperty("pendingEmail", pending);
            }
        };
    }

    @Bean
    OpenApiCustomizer approvedOpenApiVersion() {
        return openApi -> openApi.setOpenapi("3.1.2");
    }
}
