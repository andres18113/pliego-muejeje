package com.pliego.modules.storefront.api;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import com.pliego.foundation.web.ApiExceptionHandler;
import com.pliego.modules.storefront.application.SitemapService;

class SitemapControllerTest {
    @Test void errorReturnsStandardSpanishProblemWithoutSuccessCacheOrPartialXml() throws Exception {
        var service = mock(SitemapService.class);
        when(service.document()).thenThrow(new IllegalStateException("fallo"));
        var mvc = MockMvcBuilders.standaloneSetup(new SitemapController(service))
                .setControllerAdvice(new ApiExceptionHandler(new com.pliego.foundation.web.ProblemDetailFactory())).build();
        mvc.perform(get("/api/v1/storefront/sitemap.xml").accept("application/xml"))
                .andExpect(status().isInternalServerError())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.code").value("INTERNAL_SERVER_ERROR"))
                .andExpect(jsonPath("$.title").value("Error interno"))
                .andExpect(header().doesNotExist("Cache-Control"));
    }
}
