package com.pliego.modules.storefront.api;

import java.nio.charset.StandardCharsets;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import com.pliego.modules.storefront.application.SitemapService;

@RestController
public class SitemapController {
    private final SitemapService service;

    public SitemapController(SitemapService service) { this.service = service; }

    @GetMapping(path = "/api/v1/storefront/sitemap.xml", produces = "application/xml;charset=UTF-8")
    @Operation(operationId = "getStorefrontSitemap", summary = "Consultar el sitemap público de la tienda")
    public ResponseEntity<String> sitemap() {
        return ResponseEntity.ok().contentType(new MediaType("application", "xml", StandardCharsets.UTF_8))
                .cacheControl(CacheControl.maxAge(java.time.Duration.ofHours(1)).cachePublic())
                .body(service.document());
    }
}
