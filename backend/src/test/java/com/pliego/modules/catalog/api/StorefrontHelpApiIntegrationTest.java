package com.pliego.modules.catalog.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MockMvc;
import com.pliego.modules.help.application.*;
import com.pliego.modules.help.gateway.HelpGateway;
import com.pliego.modules.storefront.application.StorefrontNavigation;
import com.pliego.modules.storefront.gateway.StorefrontGateway;

@SpringBootTest(properties={"spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i4_test",
        "spring.datasource.username=pliego_test","spring.datasource.password=pliego_test","spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com","PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef","pliego.mail.enabled=false"})
@AutoConfigureMockMvc
@Import({CatalogApiIntegrationTest.CatalogTestConfiguration.class,StorefrontHelpApiIntegrationTest.TestGateways.class})
class StorefrontHelpApiIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired FakeHelpGateway help;

    @Test void publicNavigationExposesFiveSectionsAndServerDestinations() throws Exception {
        mvc.perform(get("/api/v1/storefront/navigation")).andExpect(status().isOk())
                .andExpect(jsonPath("$.sections.length()").value(5))
                .andExpect(jsonPath("$.sections[0].key").value("PHYSICAL"))
                .andExpect(jsonPath("$.sections[1].bestSellingHref").value("/catalog?productType=EBOOK&sort=BEST_SELLING"))
                .andExpect(jsonPath("$.sections[2].label").value("Audiolibros"))
                .andExpect(jsonPath("$.sections[4].href").value("/ayuda"));
    }
    @Test void helpPublishedSearchTransportsFiltersAndTotalCount() throws Exception {
        mvc.perform(get("/api/v1/help/categories")).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].slug").value("ebooks"));
        mvc.perform(get("/api/v1/help/articles").param("que","propiedad").param("category","ebooks")
                .param("applicability","EBOOK").param("page","2").param("pageSize","5"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalCount").value("12"))
                .andExpect(jsonPath("$.items[0].applicability").value("EBOOK"));
        assertEquals(List.of("propiedad","ebooks","EBOOK","2","5"),help.lastSearch);
        mvc.perform(get("/api/v1/help/articles/ebooks")).andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value("Verifica la propiedad en Mi biblioteca."));
    }
    @Test void helpMissingAndInvalidRequestsUseSpanishProblemContract() throws Exception {
        mvc.perform(get("/api/v1/help/articles/not-published")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("HELP_ARTICLE_NOT_FOUND"))
                .andExpect(jsonPath("$.title").value("Artículo no encontrado"));
        mvc.perform(get("/api/v1/help/articles").param("applicability","VIDEO"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mvc.perform(get("/api/v1/help/articles").param("pageSize","51")).andExpect(status().isBadRequest());
    }
    @TestConfiguration(proxyBeanMethods=false) static class TestGateways {
        @Bean @Primary FakeHelpGateway helpGateway() { return new FakeHelpGateway(); }
        @Bean @Primary StorefrontGateway storefrontGateway() {
            return () -> new StorefrontNavigation(List.of(
                    section("PHYSICAL","Libros"),section("EBOOK","eBooks"),section("AUDIOBOOK","Audiolibros"),
                    section("OFFERS","Ofertas"),section("HELP","Ayuda")));
        }
        private static StorefrontNavigation.Section section(String key,String label) {
            String href = switch(key) { case "OFFERS" -> "/ofertas"; case "HELP" -> "/ayuda"; default -> "/catalog?productType="+key; };
            return new StorefrontNavigation.Section(key,label,href,List.of(),List.of(),href,
                    key.equals("OFFERS")||key.equals("HELP")?null:href+"&sort=BEST_SELLING",null,"0");
        }
    }
    static class FakeHelpGateway implements HelpGateway {
        List<String> lastSearch;
        @Override public List<HelpCategory> categories() { return List.of(new HelpCategory("ebooks","eBooks",10,"EBOOK")); }
        @Override public HelpSearchPage search(String q,String category,String applicability,int page,int size) {
            lastSearch=List.of(q,category,applicability,Integer.toString(page),Integer.toString(size));
            return new HelpSearchPage(List.of(new HelpArticleSummary("ebooks","ebooks","eBooks","Propiedad",10,"EBOOK")),12);
        }
        @Override public Optional<HelpArticle> article(String slug) {
            return slug.equals("ebooks")?Optional.of(new HelpArticle("ebooks","ebooks","eBooks","Propiedad",10,"EBOOK",
                    "Verifica la propiedad en Mi biblioteca.")):Optional.empty();
        }
    }
}
