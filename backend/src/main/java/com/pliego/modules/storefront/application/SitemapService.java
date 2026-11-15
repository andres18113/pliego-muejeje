package com.pliego.modules.storefront.application;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import com.pliego.modules.storefront.gateway.SitemapGateway;

@Service
public class SitemapService {
    private static final Logger LOG = LoggerFactory.getLogger(SitemapService.class);
    private static final int MAX_BYTES = 50 * 1024 * 1024;
    private final SitemapGateway gateway;
    private final String publicUrl;
    private final Clock clock;
    // The monitor covers refresh as well as publication: one scan per application instance.
    private String cached;
    private RuntimeException failure;
    private Instant expires = Instant.MIN;

    @Autowired
    public SitemapService(SitemapGateway gateway, @Value("${pliego.mail.public-url:}") String publicUrl) {
        this(gateway, publicUrl, Clock.systemUTC());
    }

    SitemapService(SitemapGateway gateway, String publicUrl, Clock clock) {
        this.gateway = gateway;
        this.publicUrl = publicUrl;
        this.clock = clock;
    }

    public synchronized String document() {
        if (clock.instant().isBefore(expires)) {
            if (failure != null) throw failure;
            return cached;
        }
        try {
            String origin = origin();
            var paths = new ArrayList<>(List.of("/", "/catalog", "/ofertas", "/ayuda"));
            paths.addAll(gateway.paths());
            if (paths.size() > 50000) throw new IllegalStateException("El sitemap excede 50000 URLs.");
            var xml = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                    + "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
            int bytes = xml.toString().getBytes(StandardCharsets.UTF_8).length + "</urlset>\n".length();
            for (String path : paths.stream().distinct().sorted().toList()) {
                String entry = "<url><loc>" + escape(origin + path) + "</loc></url>\n";
                bytes = Math.addExact(bytes, entry.getBytes(StandardCharsets.UTF_8).length);
                if (bytes > MAX_BYTES) throw new IllegalStateException("El sitemap excede 50 MB.");
                xml.append(entry);
            }
            cached = xml.append("</urlset>\n").toString();
            failure = null;
            expires = clock.instant().plusSeconds(3600);
            return cached;
        } catch (RuntimeException exception) {
            cached = null;
            failure = new IllegalStateException("No se pudo generar el sitemap.", exception);
            expires = clock.instant().plusSeconds(60);
            LOG.error("No se pudo generar el sitemap; se rechaza el documento completo.", exception);
            throw failure;
        }
    }

    private String origin() {
        URI uri = URI.create(publicUrl);
        if (uri.getHost() == null || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) {
            throw new IllegalStateException("Configura el origen público de la tienda.");
        }
        return uri.getScheme() + "://" + uri.getRawAuthority();
    }

    private static String escape(String value) {
        if (value.codePoints().anyMatch(c -> !(c == 9 || c == 10 || c == 13 || c >= 32 && c <= 0xD7FF
                || c >= 0xE000 && c <= 0xFFFD || c >= 0x10000 && c <= 0x10FFFF))) {
            throw new IllegalStateException("URL inválida para XML.");
        }
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&apos;");
    }
}
