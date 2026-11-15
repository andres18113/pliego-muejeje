package com.pliego.modules.storefront.api;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import com.pliego.modules.storefront.gateway.SitemapGateway;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:postgresql://127.0.0.1:1/unused",
        "spring.flyway.enabled=false", "PLIEGO_ADMIN_EMAIL=admin@example.invalid",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused", "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.mail.enabled=false", "pliego.mail.public-url=https://example.org"})
@AutoConfigureMockMvc
class SitemapApiIntegrationTest {
    @Autowired MockMvc mvc;
    @MockitoBean SitemapGateway gateway;

    @Test void anonymousXmlAndExactGetSecurity() throws Exception {
        when(gateway.paths()).thenReturn(List.of("/catalog/editions/7", "/ayuda/compras"));
        mvc.perform(get("/api/v1/storefront/sitemap.xml"))
                .andExpect(status().isOk()).andExpect(content().contentType("application/xml;charset=UTF-8"))
                .andExpect(header().string("Cache-Control", "max-age=3600, public"))
                .andExpect(header().doesNotExist("Set-Cookie"))
                .andExpect(xpath("//*[local-name()='loc']").nodeCount(6));
        mvc.perform(post("/api/v1/storefront/sitemap.xml")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/storefront/sitemap.xml/private")).andExpect(status().isNotFound());
    }
}
