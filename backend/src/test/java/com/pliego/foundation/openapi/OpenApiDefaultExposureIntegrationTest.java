package com.pliego.foundation.openapi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class OpenApiDefaultExposureIntegrationTest extends OpenApiHttpTestSupport {
    @ParameterizedTest
    @ValueSource(strings = {"/v3/api-docs", "/v3/api-docs/swagger-config", "/swagger-ui.html",
            "/swagger-ui/index.html", "/swagger-ui/swagger-initializer.js"})
    void documentation_withoutContractProfile_isNotFound(String path) throws Exception {
        assertThat(get(path).statusCode()).as("anonymous GET %s", path).isEqualTo(404);
    }

    @Test
    void management_withoutContractProfile_staysDisabled() {
        assertThat(environment.matchesProfiles("contract")).isFalse();
        assertThat(environment.getProperty("management.server.port", Integer.class)).isEqualTo(-1);
        assertThat(environment.getProperty("local.management.port")).isNull();
    }

    @Test
    void catalog_withoutContractProfile_remainsPublic() throws Exception {
        when(catalog.findPublicCategories(any())).thenReturn(List.of());
        var response = get("/api/v1/catalog/categories");
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json.readTree(response.body()).path("items").isArray()).isTrue();
    }

    @Test
    void authentication_withoutContractProfile_preservesSpanishProblem() throws Exception {
        var response = get("/api/v1/me");
        assertThat(response.statusCode()).isEqualTo(401);
        var problem = json.readTree(response.body());
        assertThat(problem.path("code").asText()).isEqualTo("AUTH_REQUIRED");
        assertThat(problem.path("title").asText()).isEqualTo("Autenticación requerida");
        assertThat(problem.path("detail").asText())
                .isEqualTo("Debes iniciar sesión para realizar esta operación.");
    }
}
