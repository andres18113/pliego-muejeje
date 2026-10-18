package com.pliego.modules.billing;

import com.pliego.modules.billing.application.InvoiceRenderer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.SchemaFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InvoiceRendererTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final InvoiceRenderer renderer = new InvoiceRenderer();

    @Test
    void render_xml_shouldValidateOfficialSchemaAndPreserveSnapshotAmounts() throws Exception {
        byte[] xml = renderer.render("XML", snapshot());
        var factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        try (var ds = resource("xmldsig-core-schema.xsd"); var invoice = resource("factura_V1.1.0.xsd")) {
            var schema = factory.newSchema(new StreamSource[]{new StreamSource(ds), new StreamSource(invoice)});
            schema.newValidator().validate(new StreamSource(new ByteArrayInputStream(xml)));
        }
        var dbf = DocumentBuilderFactory.newInstance();
        dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        var document = dbf.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
        assertThat(document.getDocumentElement().getAttribute("version")).isEqualTo("1.1.0");
        assertThat(document.getElementsByTagName("descripcion").item(0).getTextContent()).isEqualTo("Álgebra & <cálculo> (edición) \\ especial");
        assertThat(document.getElementsByTagName("importeTotal").item(0).getTextContent()).isEqualTo("23.00");
        assertThat(document.getElementsByTagName("totalDescuento").item(0).getTextContent()).isEqualTo("4.00");
        assertThat(document.getElementsByTagName("precioUnitario").item(0).getTextContent()).isEqualTo("12.00");
        assertThat(document.getElementsByTagName("descuento").item(0).getTextContent()).isEqualTo("4.00");
        assertThat(document.getElementsByTagName("tarifa").item(0).getTextContent()).isEqualTo("15.00");
        String key = document.getElementsByTagName("claveAcceso").item(0).getTextContent();
        assertThat(key).matches("[0-9]{49}");
        assertThat(key.substring(0, 8)).isEqualTo("17102026");
        assertThat(key.substring(24, 39)).isEqualTo("999999000000042");
        assertThat(key).isEqualTo("1710202601999999999900119999990000000420000000010");
        String text = new String(xml, StandardCharsets.UTF_8);
        assertThat(text).contains("encoding=\"UTF-8\"", "SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA", "SINTÉTICA");
        assertThat(text).doesNotContain("<autorizacion", "<numeroAutorizacion", "<ds:Signature", "<!DOCTYPE");
        assertThat(renderer.render("XML", snapshot())).isEqualTo(xml);
    }

    @Test
    void render_pdf_manyLongDescriptions_shouldPaginateWithoutTruncatingAndUseSafeWinAnsi() throws Exception {
        ObjectNode snapshot = snapshot();
        var items = snapshot.putArray("items");
        for (int i = 0; i < 140; i++) {
            ObjectNode item = (ObjectNode) mapper.readTree(itemJson());
            item.put("description", "Línea " + i + " " + "áéíóú ñ ".repeat(30) + "FIN-" + i + " ) Tj /OpenAction (malicioso");
            items.add(item);
        }
        byte[] bytes = renderer.render("PDF", snapshot);
        String pdf = new String(bytes, StandardCharsets.ISO_8859_1);
        assertThat(pdf).startsWith("%PDF-1.4").endsWith("%%EOF\n");
        assertThat(pdf).contains("/Encoding /WinAnsiEncoding", "/BaseFont /Courier");
        assertThat(pdf).doesNotContain("/JavaScript", "/Launch", "/URI");
        String text = decodedPdfText(pdf);
        assertThat(text).contains("SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA", "José Muñoz", "23.00", "15.00");
        String body = text.lines().filter(line -> !line.startsWith("SIMULACIÓN ACADÉMICA")
                && !line.startsWith("Factura académica") && !line.startsWith("Página "))
                .collect(java.util.stream.Collectors.joining());
        for (int i = 0; i < 140; i++) {
            assertThat(body).contains("Línea " + i + " " + "áéíóú ñ ".repeat(30) + "FIN-" + i + " ) Tj /OpenAction (malicioso");
        }
        var pages = Pattern.compile("/Type /Page\\b").matcher(pdf);
        int count = 0;
        while (pages.find()) count++;
        assertThat(count).isGreaterThan(3);
        assertThat(pdf).contains("/Count " + count);
        var streams = Pattern.compile("/Length (\\d+) >>\\nstream\\n").matcher(pdf);
        while (streams.find()) {
            int end = streams.end() + Integer.parseInt(streams.group(1));
            assertThat(pdf.substring(end)).startsWith("endstream");
        }
        int xref = Integer.parseInt(pdf.substring(pdf.lastIndexOf("startxref\n") + 10).split("\n")[0]);
        assertThat(pdf.substring(xref)).startsWith("xref\n");
        String[] entries = pdf.substring(xref).split("\n");
        int size = Integer.parseInt(entries[1].split(" ")[1]);
        for (int object = 1; object < size; object++) {
            int offset = Integer.parseInt(entries[2 + object].substring(0, 10));
            assertThat(pdf.substring(offset)).startsWith(object + " 0 obj\n");
        }
    }

    @Test
    void render_xml_compoundAddress_shouldKeepEveryComponentWithoutExceedingSchemaLimits() throws Exception {
        ObjectNode s = snapshot();
        var address = (ObjectNode) s.path("billingAddress");
        String line1 = "A".repeat(191) + "\r\n\tCalle李";
        String line2 = "B".repeat(195) + "\r\n\tXY";
        assertThat(line1).hasSize(200);
        assertThat(line2).hasSize(200);
        address.put("line1", line1);
        address.put("line2", line2);
        address.put("city", "C".repeat(100));
        address.put("province", "D".repeat(100));
        address.put("postalCode", "170101");
        byte[] xml = renderer.render("XML", s); // Includes real local XSD validation.
        var document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new ByteArrayInputStream(xml));
        assertThat(document.getElementsByTagName("direccionComprador").item(0).getTextContent())
                .isEqualTo("A".repeat(191) + "   Calle李");
        var additional = document.getElementsByTagName("campoAdicional");
        var values = new java.util.HashMap<String, String>();
        for (int i = 0; i < additional.getLength(); i++) {
            var field = (org.w3c.dom.Element) additional.item(i);
            assertThat(field.getTextContent().length()).isLessThanOrEqualTo(300);
            values.put(field.getAttribute("nombre"), field.getTextContent());
        }
        assertThat(values).containsEntry("Dirección línea 1", line1).containsEntry("Dirección línea 2", line2)
                .containsEntry("Ciudad", "C".repeat(100)).containsEntry("Provincia", "D".repeat(100))
                .containsEntry("País", "EC").containsEntry("Código postal", "170101");
        assertThat(s.path("billingAddress").path("line1").asText()).isEqualTo(line1);
    }

    @Test
    void render_unicode_shouldPreserveXmlAndOriginalPdfTextWithExplicitVisibleFallback() throws Exception {
        ObjectNode s = snapshot();
        s.put("buyerName", "Ana 李");
        String description = "e\u0301 😀 (\\) [U+674E] ".repeat(180) + "FIN";
        // Stay inside the XML description contract; exercise PDF wrapping separately below.
        ((ObjectNode) s.path("items").get(0)).put("description", "e\u0301 😀 (\\) [U+674E]");
        String xml = new String(renderer.render("XML", s), StandardCharsets.UTF_8);
        assertThat(xml).contains("Ana 李", "e\u0301 😀", "[U+674E]");
        ((ObjectNode) s.path("items").get(0)).put("description", description);
        String pdf = new String(renderer.render("PDF", s), StandardCharsets.ISO_8859_1);
        String visible = decodedPdfText(pdf).replace("\n", "");
        assertThat(visible).contains("Ana [U+674E]", "e[U+0301] [U+1F600]", "Unicode", "texto original");
        var actual = Pattern.compile("/ActualText <FEFF([0-9A-F]*)>").matcher(pdf);
        StringBuilder original = new StringBuilder();
        while (actual.find()) original.append(new String(HexFormat.of().parseHex(actual.group(1)), StandardCharsets.UTF_16BE));
        // Header/footer text can occur between rows on page boundaries.
        String recovered = original.toString().replaceAll("SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA", "")
                .replaceAll("Factura académica 999-999-000000042", "").replaceAll("Página \\d+ de \\d+", "");
        assertThat(recovered).contains("Ana 李", description);
        var pageCount = Pattern.compile("/Count (\\d+)").matcher(pdf);
        assertThat(pageCount.find()).isTrue();
        assertThat(Integer.parseInt(pageCount.group(1))).isGreaterThan(1);
        assertThat(pdf).doesNotContain("/JavaScript", "/Launch", "/URI");
    }

    @Test
    void render_invalidSnapshotOrType_shouldRejectWithoutExposingPersonalData() {
        assertThatThrownBy(() -> renderer.render("HTML", snapshot())).isInstanceOf(IllegalArgumentException.class);
        for (String type : new String[]{"XML", "PDF"}) {
            assertThatThrownBy(() -> renderer.render(type, mapper.createObjectNode())).isInstanceOf(IllegalArgumentException.class);
            ObjectNode draft = snapshot(); draft.put("state", "DRAFT");
            assertThatThrownBy(() -> renderer.render(type, draft)).isInstanceOf(IllegalArgumentException.class);
            ObjectNode legacy = snapshot(); legacy.put("provenance", "LEGACY");
            assertThatThrownBy(() -> renderer.render(type, legacy)).isInstanceOf(IllegalArgumentException.class);
            ObjectNode invalid = snapshot(); invalid.put("total", "dato privado");
            assertThatThrownBy(() -> renderer.render(type, invalid)).isInstanceOf(IllegalArgumentException.class).hasMessageNotContaining("dato privado");
        }
    }

    @Test
    void render_xml_invalidSchemaData_shouldFailClosed() {
        ObjectNode invalid = snapshot();
        ((ObjectNode) invalid.path("items").get(0)).put("description", "x".repeat(301));
        assertThatThrownBy(() -> renderer.render("XML", invalid)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void render_schema_shouldMatchPinnedOfficialBytes() throws Exception {
        try (var xsd = resource("factura_V1.1.0.xsd")) {
            assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(xsd.readAllBytes())))
                    .isEqualTo("62db9bf0ecceb00ef2b7ed136e59224815e5e5e33c77efc6a0552001e052eb8b");
        }
    }

    private java.io.InputStream resource(String name) { return getClass().getResourceAsStream("/billing/schema/" + name); }

    private ObjectNode snapshot() {
        ObjectNode snapshot = (ObjectNode) mapper.readTree("""
            {"invoiceId":"42","orderId":"10","documentNumber":"999-999-000000042","state":"ISSUED","provenance":"SIMULATED",
             "buyerName":"José Muñoz","identityType":"NATIONAL_ID","identityNumber":"0000000018","buyerEmail":"academic@example.invalid",
             "currency":"USD","subtotal":"20.00","totalDiscount":"4.00","taxRate":"15.00","taxTotal":"3.00","shippingAmount":"0.00","total":"23.00","issuedAt":"2026-10-17T01:00:00-05:00",
             "issuer":{"name":"PLIEGO ACADÉMICO","identification":"9999999999001","address":"Campus académico","establishment":"999","emissionPoint":"999"},
             "billingAddress":{"line1":"Calle Ñ & campus","line2":null,"city":"Quito","province":"Pichincha","countryCode":"EC","postalCode":null},
             "taxes":[{"taxCode":"2","taxPercentageCode":"4","taxableBase":"20.00","taxAmount":"3.00"}],"items":[]}
            """);
        snapshot.withArray("items").add(mapper.readTree(itemJson()));
        return snapshot;
    }

    private String itemJson() { return """
            {"invoiceItemId":"1","orderItemId":"2","description":"Álgebra & <cálculo> (edición) \\\\ especial","quantity":2,
             "unitPrice":"10.00","originalUnitPrice":"12.00","discountAmount":"4.00","subtotal":"20.00","taxTreatment":"TAXABLE",
             "taxRate":"15.00","taxAmount":"3.00","total":"23.00","taxCode":"2","taxPercentageCode":"4"}
            """; }

    private String decodedPdfText(String pdf) {
        var matcher = Pattern.compile("\\(((?:\\\\.|[^\\\\)])*)\\) Tj").matcher(pdf);
        StringBuilder all = new StringBuilder();
        while (matcher.find()) {
            String raw = matcher.group(1);
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            for (int i = 0; i < raw.length(); i++) {
                char c = raw.charAt(i);
                if (c == '\\') {
                    if (i + 3 < raw.length() && raw.substring(i + 1, i + 4).matches("[0-7]{3}")) {
                        out.write(Integer.parseInt(raw.substring(i + 1, i + 4), 8)); i += 3;
                    } else out.write(raw.charAt(++i));
                } else out.write(c);
            }
            all.append(out.toString(java.nio.charset.Charset.forName("windows-1252"))).append('\n');
        }
        return all.toString();
    }
}
