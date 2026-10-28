package com.pliego.modules.billing;

import com.pliego.modules.billing.application.InvoiceRenderer;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
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
    void render_pdf_singleItem_shouldIncludeSnapshotValuesAndUseOneA4Page() throws Exception {
        byte[] bytes = renderer.render("PDF", snapshot());
        assertThat(bytes).hasSizeLessThan(150 * 1024);
        try (PDDocument pdf = Loader.loadPDF(bytes)) {
            assertThat(pdf.getNumberOfPages()).isEqualTo(1);
            assertThat(pdf.getPage(0).getMediaBox().getWidth()).isEqualTo(595f);
            assertThat(pdf.getPage(0).getMediaBox().getHeight()).isEqualTo(842f);
            var info = pdf.getDocumentInformation();
            assertThat(info.getTitle()).isEqualTo("Factura académica 999-999-000000042");
            assertThat(info.getProducer()).isEqualTo("PLIEGO");
            String text = new PDFTextStripper().getText(pdf);
            assertThat(text).contains("PLIEGO ACADÉMICO", "Identificación sintética: 9999999999001",
                    "Campus académico", "Entorno académico sin validez tributaria", "999-999-000000042",
                    "Pedido: 10", "Fecha de emisión", "SIMULACIÓN ACADÉMICA", "Ambiente: SIMULACIÓN ACADÉMICA",
                    "Autorización SRI: No aplica — documento académico", "José Muñoz", "Cédula: 0000000018",
                    "Calle Ñ & campus", "academic@example.invalid", "Álgebra & <cálculo> (edición) \\ especial",
                    "12.00", "4.00", "15.00", "20.00", "Subtotal IVA 15%", "Subtotal sin impuestos",
                    "Total descuento", "IVA", "Envío", "VALOR TOTAL", "23.00", "Forma de pago", "Tarjeta",
                    "SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA",
                    "Documento sin firma electrónica. No constituye autorización SRI.", "Página 1 de 1");
            assertThat(text).doesNotContain("CLAVE DE ACCESO", "NÚMERO DE AUTORIZACIÓN", "Código de barras");
        }
        assertThat(renderer.render("PDF", snapshot())).isEqualTo(bytes);
    }

    @Test
    void render_pdf_customerFields_shouldUseAlignedLabelValueColumnsAndWrapAddress() throws Exception {
        ObjectNode data = snapshot();
        data.put("buyerEmail", "ana@example.invalid");
        ((ObjectNode) data.path("billingAddress")).put("line1", "Avenida de las letras ".repeat(8));
        try (PDDocument pdf = Loader.loadPDF(renderer.render("PDF", data))) {
            var positions = new PositionedTextStripper();
            positions.getText(pdf);
            float nameX = positions.xOf("José Muñoz");
            float dateX = positions.xOfInRow("17/10/2026", "Fecha de emisión");
            float addressX = positions.xOf("Avenida de las letras");
            float identityX = positions.xOf("Cédula: 0000000018");
            float emailX = positions.xOf("ana");
            assertThat(nameX).isCloseTo(dateX, org.assertj.core.data.Offset.offset(0.5f));
            assertThat(nameX).isCloseTo(addressX, org.assertj.core.data.Offset.offset(0.5f));
            assertThat(identityX).isCloseTo(emailX, org.assertj.core.data.Offset.offset(0.5f));
            String extracted = new PDFTextStripper().getText(pdf);
            assertThat(extracted).contains("Avenida de las letras", "Quito", "Pichincha");
            assertThat(extracted.split("Avenida", -1).length - 1).isEqualTo(8);
        }
    }

    @Test
    void render_pdf_70LongDescriptions_shouldRepeatHeadersAndKeepSummaryTogetherOnLastPage() throws Exception {
        ObjectNode snapshot = snapshot();
        var items = snapshot.putArray("items");
        for (int i = 0; i < 70; i++) {
            ObjectNode item = (ObjectNode) mapper.readTree(itemJson());
            item.put("invoiceItemId", Integer.toString(i + 1));
            item.put("description", "Título largo " + i + " — áéíóú ñ ".repeat(12) + "FIN-" + i);
            items.add(item);
        }
        byte[] bytes = renderer.render("PDF", snapshot);
        try (PDDocument pdf = Loader.loadPDF(bytes)) {
            assertThat(pdf.getNumberOfPages()).isGreaterThan(1);
            assertThat(pdf.getDocumentInformation().getTitle()).isEqualTo("Factura académica 999-999-000000042");
            assertThat(pdf.getDocumentInformation().getProducer()).isEqualTo("PLIEGO");
            PDFTextStripper stripper = new PDFTextStripper();
            String text = stripper.getText(pdf);
            for (int i = 0; i < 70; i++) assertThat(text).contains("Título largo " + i, "FIN-" + i);
            assertThat(text).contains("Código", "Cant.", "Descripción", "Precio unitario", "Descuento", "IVA %", "Precio total");
            assertThat(text).contains("Subtotal IVA 15%", "Subtotal sin impuestos", "Total descuento", "VALOR TOTAL");
            assertThat(text.lines().filter(line -> line.contains("VALOR TOTAL")).count()).isEqualTo(1);
            assertThat(text.lines().filter(line -> line.contains("Subtotal IVA 15%")).count()).isEqualTo(1);
            for (int page = 1; page <= pdf.getNumberOfPages(); page++) {
                stripper.setStartPage(page);
                stripper.setEndPage(page);
                String pageText = stripper.getText(pdf);
                assertThat(pageText).contains("SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA");
                assertThat(pageText).contains("Documento sin firma electrónica. No constituye autorización SRI.");
                assertThat(pageText).contains("Página " + page + " de " + pdf.getNumberOfPages());
                if (page > 1 && pageText.contains("Título largo"))
                    assertThat(pageText).contains("Código", "Descripción", "Precio unitario");
                if (page < pdf.getNumberOfPages()) assertThat(pageText).doesNotContain("VALOR TOTAL", "Información adicional");
                if (page == pdf.getNumberOfPages()) assertThat(pageText).contains("VALOR TOTAL", "Información adicional");
            }
        }
    }

    @Test
    void render_pdf_visualReviewSamples_shouldWriteOnePageAndMultipageFiles() throws Exception {
        java.nio.file.Path samples = java.nio.file.Path.of("/tmp/claude-1000/-home-andres18123-PLIEGO/a47bcd7b-ad29-480d-9eb9-444e650de42e/scratchpad/samples");
        java.nio.file.Files.createDirectories(samples);
        java.nio.file.Files.write(samples.resolve("invoice-single.pdf"), renderer.render("PDF", snapshot()));
        ObjectNode multiple = snapshot();
        var items = multiple.putArray("items");
        for (int i = 0; i < 70; i++) {
            ObjectNode item = (ObjectNode) mapper.readTree(itemJson());
            item.put("invoiceItemId", Integer.toString(i + 1));
            item.put("description", "Título largo " + i + " — áéíóú ñ ".repeat(12) + "FIN-" + i);
            items.add(item);
        }
        java.nio.file.Files.write(samples.resolve("invoice-multipage.pdf"), renderer.render("PDF", multiple));
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
    void render_unicode_shouldEmbedRobotoAndReplaceUnsupportedCjkWithoutFailing() throws Exception {
        ObjectNode s = snapshot();
        s.put("buyerName", "Ana 李");
        String description = "Lectura ñandú, ábaco, «título» — 李";
        ((ObjectNode) s.path("items").get(0)).put("description", description);
        String xml = new String(renderer.render("XML", s), StandardCharsets.UTF_8);
        assertThat(xml).contains("Ana 李", description);
        byte[] pdfBytes = renderer.render("PDF", s);
        try (PDDocument pdf = Loader.loadPDF(pdfBytes)) {
            String visible = new PDFTextStripper().getText(pdf);
            assertThat(visible).contains("ñandú", "ábaco", "«título»", "—");
            assertThat(visible).contains("Ana ?").doesNotContain("李");
            assertThat(visible).contains("Ana ?");
        }
        assertThat(renderer.render("PDF", s)).isEqualTo(pdfBytes);
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
    void render_ruc_buyer_shouldUseSriCode04AndLabelTheRuc() throws Exception {
        ObjectNode ruc = snapshot(); ruc.put("identityType", "TAX_ID"); ruc.put("identityNumber", "1790016919001");
        String xml = new String(renderer.render("XML", ruc), StandardCharsets.UTF_8);
        assertThat(xml).contains("<tipoIdentificacionComprador>04</tipoIdentificacionComprador>", "<identificacionComprador>1790016919001</identificacionComprador>");
        assertThat(new String(renderer.render("XML", snapshot()), StandardCharsets.UTF_8)).contains("<tipoIdentificacionComprador>05</tipoIdentificacionComprador>");
        String pdf = pdfText(renderer.render("PDF", ruc));
        assertThat(pdf).contains("RUC: 1790016919001").doesNotContain("Cédula:");
        assertThat(pdfText(renderer.render("PDF", snapshot()))).contains("Cédula: 0000000018").doesNotContain("RUC:");
        for (String[] invalid : new String[][]{{"TAX_ID", "0000000018"}, {"NATIONAL_ID", "1790016919001"}, {"PASSPORT", "0000000018"}}) {
            ObjectNode wrong = snapshot(); wrong.put("identityType", invalid[0]); wrong.put("identityNumber", invalid[1]);
            assertThatThrownBy(() -> renderer.render("XML", wrong)).isInstanceOf(IllegalArgumentException.class);
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
             "payment":{"method":"CARD","amount":"23.00"},
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

    private String pdfText(byte[] bytes) throws Exception {
        try (PDDocument pdf = Loader.loadPDF(bytes)) { return new PDFTextStripper().getText(pdf); }
    }

    private static final class PositionedTextStripper extends PDFTextStripper {
        private final java.util.List<PositionedRun> runs = new java.util.ArrayList<>();
        private PositionedTextStripper() throws java.io.IOException { }

        @Override protected void writeString(String text, java.util.List<TextPosition> positions) throws java.io.IOException {
            if (!positions.isEmpty()) runs.add(new PositionedRun(text, java.util.List.copyOf(positions), positions.get(0).getYDirAdj()));
            super.writeString(text, positions);
        }

        private float xOf(String value) {
            for (PositionedRun run : runs) {
                int at = run.text().indexOf(value);
                if (at < 0) continue;
                return run.positions().get(at).getXDirAdj();
            }
            throw new AssertionError("No se encontró texto del PDF: " + value);
        }

        private float xOfInRow(String value, String rowLabel) {
            float rowY = runs.stream().filter(run -> run.text().contains(rowLabel)).map(PositionedRun::y)
                    .max(Float::compare).orElseThrow(() -> new AssertionError("No se encontró etiqueta: " + rowLabel));
            for (PositionedRun run : runs) {
                int at = run.text().indexOf(value);
                if (at >= 0 && Math.abs(run.y() - rowY) < 1f) return run.positions().get(at).getXDirAdj();
            }
            throw new AssertionError("No se encontró el valor alineado: " + value);
        }
    }

    private record PositionedRun(String text, java.util.List<TextPosition> positions, float y) { }
}
