package com.pliego.modules.storefront.application;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.io.StringReader;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import javax.xml.parsers.DocumentBuilderFactory;
import org.xml.sax.InputSource;
import org.junit.jupiter.api.Test;
import com.pliego.modules.storefront.gateway.SitemapGateway;

class SitemapServiceTest {
    private final SitemapGateway gateway = mock(SitemapGateway.class);
    private final MutableClock clock = new MutableClock();
    private final SitemapService service = new SitemapService(gateway, "https://example.org/", clock);

    @Test void generatesWellFormedEscapedXmlWithStableOrderAndOnlyLocations() throws Exception {
        when(gateway.paths()).thenReturn(List.of("/catalog/editions/9", "/ayuda/a&b", "/catalog/editions/2"));
        String xml = service.document();
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        var root = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml))).getDocumentElement();
        assertThat(root.getNamespaceURI()).isEqualTo("http://www.sitemaps.org/schemas/sitemap/0.9");
        assertThat(root.getElementsByTagName("loc").getLength()).isEqualTo(7);
        assertThat(xml).contains("https://example.org/ayuda/a&amp;b");
        assertThat(xml.indexOf("editions/2")).isLessThan(xml.indexOf("editions/9"));
        assertThat(xml).doesNotContain("lastmod", "priority", "changefreq");
    }

    @Test void concurrentRequestsShareDocumentAndRefreshAfterOneHour() throws Exception {
        when(gateway.paths()).thenReturn(List.of());
        try (var pool = Executors.newFixedThreadPool(8)) {
            var requests = new ArrayList<Callable<String>>();
            for (int i=0;i<20;i++) requests.add(service::document);
            for (var result : pool.invokeAll(requests)) assertThat(result.get()).contains("<urlset");
        }
        verify(gateway).paths();
        clock.now = clock.now.plusSeconds(3600);
        service.document();
        verify(gateway, times(2)).paths();
    }

    @Test void failuresAreClosedAndThrottledAndExpiredSuccessIsNeverReturned() {
        when(gateway.paths()).thenReturn(List.of()).thenThrow(new IllegalStateException("database"));
        service.document();
        clock.now = clock.now.plusSeconds(3600);
        assertThatThrownBy(service::document).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(service::document).isInstanceOf(IllegalStateException.class);
        verify(gateway, times(2)).paths();
        clock.now = clock.now.plusSeconds(60);
        assertThatThrownBy(service::document).isInstanceOf(IllegalStateException.class);
        verify(gateway, times(3)).paths();
    }

    @Test void refusesCountAndUtf8SizeOverflowAndInvalidOrigin() {
        when(gateway.paths()).thenReturn(Collections.nCopies(49997, "/unique"));
        assertThatThrownBy(service::document).isInstanceOf(IllegalStateException.class);
        var other = new SitemapService(gateway, "https://example.org", clock);
        when(gateway.paths()).thenReturn(List.of("/" + "é".repeat(26_214_400)));
        assertThatThrownBy(other::document).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new SitemapService(gateway, "", clock).document())
                .isInstanceOf(IllegalStateException.class);
    }

    @Test void acceptsExactlyFiftyThousandUrlsAndRejectsInvalidXmlCharacters() {
        when(gateway.paths()).thenReturn(java.util.stream.IntStream.range(0, 49996)
                .mapToObj(i -> "/catalog/editions/" + i).toList());
        assertThat(service.document().split("<loc>")).hasSize(50001);
        when(gateway.paths()).thenReturn(List.of("/ayuda/invalid\u0001"));
        assertThatThrownBy(() -> new SitemapService(gateway, "https://example.org", clock).document())
                .isInstanceOf(IllegalStateException.class);
    }

    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-11-15T00:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
}
