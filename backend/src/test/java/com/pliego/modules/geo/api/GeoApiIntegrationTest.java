package com.pliego.modules.geo.api;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import com.pliego.modules.geo.gateway.GeoGateway;
import com.pliego.modules.geo.gateway.GeoGateway.CityRow;
import com.pliego.modules.geo.gateway.GeoGateway.ProvinceRow;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_geo_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(GeoApiIntegrationTest.TestTransactions.class)
class GeoApiIntegrationTest {
    @Autowired MockMvc mvc;

    @MockitoBean GeoGateway gateway;

    @TestConfiguration(proxyBeanMethods=false)
    static class TestTransactions {
        @Bean PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) {
                    return new SimpleTransactionStatus();
                }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }
    }

    @Test
    void publicProvinceReadReturnsStringIdsAndReferenceCacheHeaders() throws Exception {
        when(gateway.listProvinces()).thenReturn(List.of(new ProvinceRow(17,"17","Pichincha")));
        mvc.perform(get("/api/v1/geo/provinces").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control","public, max-age=86400, stale-while-revalidate=86400"))
                .andExpect(jsonPath("$[0].id").value("17"))
                .andExpect(jsonPath("$[0].code").value("17"))
                .andExpect(jsonPath("$[0].name").value("Pichincha"));
    }

    @Test
    void publicCityReadIncludesKindAndCantonName() throws Exception {
        when(gateway.listCities(17)).thenReturn(List.of(new CityRow(801,"1701","Quito",
                "CABECERA_CANTONAL","Distrito Metropolitano de Quito",List.of("San Francisco de Quito"))));
        mvc.perform(get("/api/v1/geo/provinces/17/cities").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control","public, max-age=86400, stale-while-revalidate=86400"))
                .andExpect(jsonPath("$[0].id").value("801"))
                .andExpect(jsonPath("$[0].code").value("1701"))
                .andExpect(jsonPath("$[0].name").value("Quito"))
                .andExpect(jsonPath("$[0].kind").value("CABECERA_CANTONAL"))
                .andExpect(jsonPath("$[0].cantonName").value("Distrito Metropolitano de Quito"))
                .andExpect(jsonPath("$[0].aliases[0]").value("San Francisco de Quito"));
    }

    @Test
    void malformedProvinceIdReturnsSpanishProblemDetails() throws Exception {
        mvc.perform(get("/api/v1/geo/provinces/0/cities"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }
}
