package com.pliego.foundation.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.ActiveProfiles;

@ActiveProfiles("contract")
class OpenApiContractProfileIntegrationTest extends OpenApiHttpTestSupport {
    @Test
    void documentation_withContractProfile_exportsRealControllerContract() throws Exception {
        var response = get("/v3/api-docs");
        assertThat(response.statusCode()).isEqualTo(200);
        var contract = json.readTree(response.body());
        assertThat(contract.path("openapi").asText()).startsWith("3.");
        assertThat(contract.path("info").path("title").asText()).isEqualTo("PLIEGO API");
        assertThat(contract.path("paths").has("/api/v1/catalog/editions")).isTrue();
        assertThat(contract.path("paths").has("/api/v1/admin/orders")).isTrue();
        assertThat(contract.path("paths").path("/api/v1/storefront/sitemap.xml").path("get")
                .path("operationId").asText()).isEqualTo("getStorefrontSitemap");
        assertThat(contract.path("paths").path("/api/v1/storefront/sitemap.xml").path("get")
                .path("responses").path("200").path("content").has("application/xml;charset=UTF-8")).isTrue();
        assertThat(contract.path("components").path("schemas").size()).isGreaterThan(20);
        var output = Path.of(System.getProperty("pliego.openapi.evidence", "target/openapi-contract.json"));
        Files.createDirectories(output.toAbsolutePath().getParent());
        Files.writeString(output, response.body());
    }

    @Test
    void documentation_describesRequiredNullableEditionAvailabilityReasons() throws Exception {
        var response = get("/v3/api-docs");
        assertThat(response.statusCode()).isEqualTo(200);
        var schemas = json.readTree(response.body()).path("components").path("schemas");
        for (String name : List.of("CatalogEditionSummaryResponse", "CatalogEditionDetailResponse", "CustomerFavorite")) {
            var schema = schemas.path(name);
            var reason = schema.path("properties").path("unavailabilityReason");
            assertThat(json.treeToValue(schema.path("required"), String[].class)).as(name)
                    .contains("unavailabilityReason");
            assertThat(json.treeToValue(reason.path("type"), String[].class)).as(name)
                    .containsExactlyInAnyOrder("string", "null");
            assertThat(json.treeToValue(reason.path("enum"), String[].class)).as(name)
                    .containsExactlyInAnyOrder("OUT_OF_STOCK", "P2042", "P2043", null);
            assertThat(reason.path("description").asText()).as(name).contains("edición", "libro", "existencias");
        }
    }

    @Test
    void swaggerUi_withContractProfile_servesUiAndConfiguration() throws Exception {
        assertThat(get("/swagger-ui/index.html").statusCode()).isEqualTo(200);
        var config = get("/v3/api-docs/swagger-config");
        assertThat(config.statusCode()).isEqualTo(200);
        assertThat(json.readTree(config.body()).path("url").asText()).isEqualTo("/v3/api-docs");
    }
}
