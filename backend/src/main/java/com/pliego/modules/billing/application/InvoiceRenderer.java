package com.pliego.modules.billing.application;

import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import javax.xml.XMLConstants;
import javax.xml.stream.XMLOutputFactory;
import javax.xml.stream.XMLStreamWriter;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/** Formats immutable Database API projections; never prices or aggregates a purchase. */
@Component
public class InvoiceRenderer {
    static final String LEGEND = "SIMULACIÓN ACADÉMICA — SIN VALIDEZ TRIBUTARIA";
    private static final String INVALID = "No se puede generar el documento académico con los datos disponibles";

    public byte[] render(String type, JsonNode snapshot) {
        if (!"PDF".equals(type) && !"XML".equals(type)) {
            throw new IllegalArgumentException("Tipo de documento no admitido");
        }
        try {
            validateSnapshot(snapshot);
            return "XML".equals(type) ? xml(snapshot) : AcademicInvoicePdf.render(snapshot);
        } catch (Exception exception) {
            // Neither exception messages nor causes may disclose the immutable fiscal snapshot.
            throw new IllegalArgumentException(INVALID);
        }
    }

    private static void validateSnapshot(JsonNode s) {
        if (s == null || !s.isObject() || !"ISSUED".equals(text(s, "state"))
                || !"SIMULATED".equals(text(s, "provenance"))) throw new IllegalArgumentException();
        for (String field : new String[]{"invoiceId", "orderId", "buyerName", "identityNumber", "currency"}) text(s, field);
        if (!"USD".equals(text(s, "currency"))) throw new IllegalArgumentException();
        if (!"NATIONAL_ID".equals(text(s, "identityType")) && !"EC_CEDULA".equals(text(s, "identityType"))) throw new IllegalArgumentException();
        if (!text(s, "identityNumber").matches("[0-9]{10}")) throw new IllegalArgumentException();
        if (!text(s, "documentNumber").matches("999-999-[0-9]{9}")) throw new IllegalArgumentException();
        date(s);
        for (String field : new String[]{"subtotal", "totalDiscount", "taxTotal", "shippingAmount", "total"}) amount(s, field);
        var issuer = s.path("issuer");
        for (String field : new String[]{"name", "address"}) text(issuer, field);
        if (!text(issuer, "identification").matches("[0-9]{13}")
                || !"999".equals(text(issuer, "establishment")) || !"999".equals(text(issuer, "emissionPoint"))) throw new IllegalArgumentException();
        var address = s.path("billingAddress");
        for (String field : new String[]{"line1", "city", "province", "countryCode"}) text(address, field);
        if (!s.path("items").isArray() || s.path("items").isEmpty() || !s.path("taxes").isArray() || s.path("taxes").isEmpty()) throw new IllegalArgumentException();
        for (var item : s.path("items")) {
            for (String field : new String[]{"invoiceItemId", "description"}) text(item, field);
            if (decimal(item, "quantity").signum() <= 0) throw new IllegalArgumentException();
            for (String field : new String[]{"unitPrice", "originalUnitPrice", "discountAmount", "subtotal", "taxRate", "taxAmount", "total"}) amount(item, field);
            taxCodes(item);
        }
        for (var tax : s.path("taxes")) {
            taxCodes(tax); amount(tax, "taxableBase"); amount(tax, "taxAmount");
        }
    }

    // Validate the projected SRI codes without inferring tax treatment from amounts.
    private static void taxCodes(JsonNode node) {
        if (!"2".equals(text(node, "taxCode")) || !text(node, "taxPercentageCode").matches("0|2|3|4|6|7|8|10")) throw new IllegalArgumentException();
    }

    static String text(JsonNode node, String field) {
        var value = node.path(field);
        if ((!value.isString() && !value.isNumber()) || value.asText().isBlank()) throw new IllegalArgumentException();
        return value.asText();
    }

    static String optional(JsonNode node, String field) {
        return node.path(field).isMissingNode() || node.path(field).isNull() ? "" : text(node, field);
    }

    private static BigDecimal decimal(JsonNode node, String field) {
        BigDecimal value = new BigDecimal(text(node, field));
        if (value.signum() < 0 || value.precision() > 20 || Math.abs(value.scale()) > 6) throw new IllegalArgumentException();
        return value;
    }

    static String amount(JsonNode node, String field) {
        return decimal(node, field).setScale(2, RoundingMode.UNNECESSARY).toPlainString();
    }

    static String date(JsonNode node) {
        return OffsetDateTime.parse(text(node, "issuedAt")).atZoneSameInstant(ZoneId.of("America/Guayaquil"))
                .format(DateTimeFormatter.ofPattern("dd/MM/uuuu"));
    }

    static String address(JsonNode node) {
        StringBuilder result = new StringBuilder();
        for (String field : new String[]{"line1", "line2", "city", "province", "countryCode", "postalCode"}) {
            String value = optional(node, field);
            if (!value.isEmpty()) { if (!result.isEmpty()) result.append(", "); result.append(value); }
        }
        return result.toString();
    }

    private static byte[] xml(JsonNode s) throws Exception {
        var output = new ByteArrayOutputStream();
        XMLStreamWriter w = XMLOutputFactory.newFactory().createXMLStreamWriter(output, StandardCharsets.UTF_8.name());
        w.writeStartDocument(StandardCharsets.UTF_8.name(), "1.0");
        w.writeStartElement("factura"); w.writeAttribute("id", "comprobante"); w.writeAttribute("version", "1.1.0");
        var issuer = s.path("issuer");
        String sequence = text(s, "documentNumber").substring(8);
        w.writeStartElement("infoTributaria");
        element(w, "ambiente", "1"); element(w, "tipoEmision", "1");
        element(w, "razonSocial", text(issuer, "name")); element(w, "ruc", text(issuer, "identification"));
        element(w, "claveAcceso", syntheticKey(s, sequence)); element(w, "codDoc", "01");
        element(w, "estab", text(issuer, "establishment")); element(w, "ptoEmi", text(issuer, "emissionPoint"));
        element(w, "secuencial", sequence); element(w, "dirMatriz", text(issuer, "address"));
        w.writeEndElement();
        w.writeStartElement("infoFactura");
        element(w, "fechaEmision", date(s)); element(w, "tipoIdentificacionComprador", "05");
        element(w, "razonSocialComprador", text(s, "buyerName")); element(w, "identificacionComprador", text(s, "identityNumber"));
        // XSD limits this summary to 300 characters; line1 is at most 200.
        // Preserve every original component separately below, including whitespace.
        element(w, "direccionComprador", text(s.path("billingAddress"), "line1").replaceAll("[\\r\\n\\t]", " "));
        element(w, "totalSinImpuestos", amount(s, "subtotal")); element(w, "totalDescuento", amount(s, "totalDiscount"));
        w.writeStartElement("totalConImpuestos");
        for (var tax : s.path("taxes")) {
            w.writeStartElement("totalImpuesto");
            element(w, "codigo", text(tax, "taxCode")); element(w, "codigoPorcentaje", text(tax, "taxPercentageCode"));
            element(w, "baseImponible", amount(tax, "taxableBase")); element(w, "valor", amount(tax, "taxAmount"));
            w.writeEndElement();
        }
        w.writeEndElement();
        element(w, "importeTotal", amount(s, "total")); element(w, "moneda", text(s, "currency"));
        w.writeEndElement();
        w.writeStartElement("detalles");
        for (var item : s.path("items")) {
            w.writeStartElement("detalle"); element(w, "codigoPrincipal", text(item, "invoiceItemId"));
            element(w, "descripcion", text(item, "description")); element(w, "cantidad", decimal(item, "quantity").toPlainString());
            element(w, "precioUnitario", amount(item, "originalUnitPrice")); element(w, "descuento", amount(item, "discountAmount"));
            element(w, "precioTotalSinImpuesto", amount(item, "subtotal"));
            w.writeStartElement("impuestos"); w.writeStartElement("impuesto");
            element(w, "codigo", text(item, "taxCode")); element(w, "codigoPorcentaje", text(item, "taxPercentageCode"));
            element(w, "tarifa", amount(item, "taxRate")); element(w, "baseImponible", amount(item, "subtotal"));
            element(w, "valor", amount(item, "taxAmount"));
            w.writeEndElement(); w.writeEndElement(); w.writeEndElement();
        }
        w.writeEndElement();
        w.writeStartElement("infoAdicional");
        additional(w, "Leyenda", LEGEND);
        additional(w, "Clave de acceso", "SINTÉTICA: solo estructura académica; no constituye autorización SRI");
        additional(w, "Emisor", "Emisor sintético académico");
        additional(w, "Envío", amount(s, "shippingAmount"));
        var billingAddress = s.path("billingAddress");
        String[] addressFields = {"line1", "line2", "city", "province", "countryCode", "postalCode"};
        String[] addressLabels = {"Dirección línea 1", "Dirección línea 2", "Ciudad", "Provincia", "País", "Código postal"};
        for (int i = 0; i < addressFields.length; i++) {
            String value = optional(billingAddress, addressFields[i]);
            if (!value.isEmpty()) additional(w, addressLabels[i], value);
        }
        if (!optional(s, "buyerEmail").isEmpty()) additional(w, "Correo", optional(s, "buyerEmail"));
        w.writeEndElement(); w.writeEndElement(); w.writeEndDocument(); w.close();
        byte[] bytes = output.toByteArray();
        var validator = InvoiceSchema.VALUE.newValidator();
        validator.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, ""); validator.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        validator.setErrorHandler(new org.xml.sax.helpers.DefaultHandler() {
            @Override public void error(org.xml.sax.SAXParseException e) throws org.xml.sax.SAXException { throw e; }
            @Override public void fatalError(org.xml.sax.SAXParseException e) throws org.xml.sax.SAXException { throw e; }
        });
        validator.validate(new StreamSource(new ByteArrayInputStream(bytes)));
        return bytes;
    }

    private static void element(XMLStreamWriter writer, String name, String value) throws Exception {
        writer.writeStartElement(name); writer.writeCharacters(value); writer.writeEndElement();
    }

    private static void additional(XMLStreamWriter writer, String name, String value) throws Exception {
        writer.writeStartElement("campoAdicional"); writer.writeAttribute("nombre", name);
        // XML parsers normalize literal CR to LF. A reference preserves the snapshot.
        String[] parts = value.split("\r", -1);
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) writer.writeEntityRef("#xD");
            writer.writeCharacters(parts[i]);
        }
        writer.writeEndElement();
    }

    private static String syntheticKey(JsonNode s, String sequence) {
        String base = date(s).replace("/", "") + "01" + text(s.path("issuer"), "identification")
                + "1" + "999999" + sequence + "00000000" + "1";
        int sum = 0;
        for (int i = base.length() - 1, weight = 2; i >= 0; i--, weight = weight == 7 ? 2 : weight + 1) sum += (base.charAt(i) - '0') * weight;
        int check = 11 - sum % 11;
        return base + (check == 11 ? 0 : check == 10 ? 1 : check);
    }

    /** Schema is immutable/thread safe; validators are created per render. No network resolution. */
    private static final class InvoiceSchema {
        private static final Schema VALUE = load();
        private static Schema load() {
            try (InputStream ds = resource("xmldsig-core-schema.xsd"); InputStream factura = resource("factura_V1.1.0.xsd")) {
                var factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
                factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
                factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, ""); factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
                return factory.newSchema(new StreamSource[]{new StreamSource(ds), new StreamSource(factura)});
            } catch (Exception e) { throw new IllegalStateException("No se pudo cargar el esquema académico local"); }
        }
        private static InputStream resource(String name) { return InvoiceRenderer.class.getResourceAsStream("/billing/schema/" + name); }
    }
}
