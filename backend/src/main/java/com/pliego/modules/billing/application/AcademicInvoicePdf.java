package com.pliego.modules.billing.application;

import tools.jackson.databind.JsonNode;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.HexFormat;
import java.util.Locale;

import static com.pliego.modules.billing.application.InvoiceRenderer.*;

/** PDF 1.4: WinAnsi glyphs plus explicit Unicode escapes and original UTF-16 ActualText. */
final class AcademicInvoicePdf {
    private static final Charset WIN_ANSI = Charset.forName("windows-1252");
    private static final int WIDTH = 82;
    private static final int ROWS_PER_PAGE = 45;

    private AcademicInvoicePdf() {}

    static byte[] render(JsonNode s) {
        List<PdfRow> rows = new ArrayList<>();
        row(rows, "Emisor académico: " + text(s.path("issuer"), "name"));
        row(rows, "Identificación sintética: " + text(s.path("issuer"), "identification"));
        row(rows, "Dirección del emisor: " + text(s.path("issuer"), "address"));
        row(rows, "Fecha: " + date(s) + " | Pedido: " + text(s, "orderId"));
        row(rows, "Comprador: " + text(s, "buyerName"));
        row(rows, "Cédula: " + text(s, "identityNumber"));
        row(rows, "Dirección de facturación: " + address(s.path("billingAddress")));
        if (!optional(s, "buyerEmail").isEmpty()) row(rows, "Correo: " + optional(s, "buyerEmail"));
        row(rows, "Moneda: " + text(s, "currency"));
        row(rows, "");
        int index = 1;
        for (var item : s.path("items")) {
            row(rows, index++ + ". " + text(item, "description"));
            row(rows, "Cantidad: " + text(item, "quantity") + " | Precio original: " + amount(item, "originalUnitPrice")
                    + " | Precio neto: " + amount(item, "unitPrice"));
            row(rows, "Descuento: " + amount(item, "discountAmount") + " | Base: " + amount(item, "subtotal")
                    + " | Impuesto (" + amount(item, "taxRate") + "%): " + amount(item, "taxAmount") + " | Total: " + amount(item, "total"));
            row(rows, "");
        }
        row(rows, "Subtotal sin impuestos: " + amount(s, "subtotal"));
        row(rows, "Descuento total: " + amount(s, "totalDiscount"));
        for (var tax : s.path("taxes")) row(rows, "Impuesto " + text(tax, "taxCode") + "/" + text(tax, "taxPercentageCode")
                + " | Base: " + amount(tax, "taxableBase") + " | Valor: " + amount(tax, "taxAmount"));
        row(rows, "Impuestos: " + amount(s, "taxTotal"));
        row(rows, "Envío: " + amount(s, "shippingAmount"));
        row(rows, "TOTAL " + text(s, "currency") + ": " + amount(s, "total"));
        row(rows, "Documento sin firma electrónica. No constituye autorización SRI.");
        if (rows.stream().anyMatch(line -> !line.visible().equals(line.original()))) {
            row(rows, "Unicode fuera de WinAnsi: [U+HEX] representa el carácter; el texto original se conserva en ActualText y XML.");
        }
        int pages = (rows.size() + ROWS_PER_PAGE - 1) / ROWS_PER_PAGE;
        List<byte[]> objects = new ArrayList<>();
        objects.add(ascii("<< /Type /Catalog /Pages 2 0 R >>"));
        StringBuilder kids = new StringBuilder();
        for (int page = 0; page < pages; page++) kids.append(4 + page * 2).append(" 0 R ");
        objects.add(ascii("<< /Type /Pages /Kids [" + kids + "] /Count " + pages + " >>"));
        objects.add(ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"));
        for (int page = 0; page < pages; page++) {
            int content = 5 + page * 2;
            objects.add(ascii("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " + content + " 0 R >>"));
            StringBuilder stream = new StringBuilder("BT\n/F1 10 Tf\n");
            draw(stream, LEGEND, 794);
            draw(stream, "Factura académica " + text(s, "documentNumber"), 772);
            int start = page * ROWS_PER_PAGE;
            for (int line = start; line < Math.min(start + ROWS_PER_PAGE, rows.size()); line++) draw(stream, rows.get(line), 744 - (line - start) * 15);
            draw(stream, "Página " + (page + 1) + " de " + pages, 35);
            stream.append("ET\n");
            byte[] data = ascii(stream.toString());
            var body = new ByteArrayOutputStream();
            body.writeBytes(ascii("<< /Length " + data.length + " >>\nstream\n"));
            body.writeBytes(data); body.writeBytes(ascii("endstream")); objects.add(body.toByteArray());
        }
        var output = new ByteArrayOutputStream();
        output.writeBytes("%PDF-1.4\n%âãÏÓ\n".getBytes(StandardCharsets.ISO_8859_1));
        List<Integer> offsets = new ArrayList<>();
        for (int i = 0; i < objects.size(); i++) {
            offsets.add(output.size()); output.writeBytes(ascii((i + 1) + " 0 obj\n"));
            output.writeBytes(objects.get(i)); output.writeBytes(ascii("\nendobj\n"));
        }
        int xref = output.size();
        output.writeBytes(ascii("xref\n0 " + (objects.size() + 1) + "\n0000000000 65535 f \n"));
        for (int offset : offsets) output.writeBytes(ascii(String.format(Locale.ROOT, "%010d 00000 n \n", offset)));
        output.writeBytes(ascii("trailer\n<< /Size " + (objects.size() + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n"));
        return output.toByteArray();
    }

    private record PdfRow(String visible, String original) { }

    private static void row(List<PdfRow> rows, String value) {
        StringBuilder visible = new StringBuilder();
        StringBuilder original = new StringBuilder();
        var encoder = WIN_ANSI.newEncoder();
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            String character = new String(Character.toChars(codePoint));
            // Controls and line separators must not change PDF structure or line layout.
            String shown = !Character.isISOControl(codePoint) && codePoint != 0x2028 && codePoint != 0x2029
                    && encoder.canEncode(character) ? character : String.format(Locale.ROOT, "[U+%04X]", codePoint);
            if (visible.length() + shown.length() > WIDTH) {
                rows.add(new PdfRow(visible.toString(), original.toString()));
                visible.setLength(0); original.setLength(0);
            }
            visible.append(shown); original.append(character);
            offset += Character.charCount(codePoint);
        }
        if (!visible.isEmpty() || value.isEmpty()) rows.add(new PdfRow(visible.toString(), original.toString()));
    }

    private static void draw(StringBuilder stream, String text, int y) {
        draw(stream, new PdfRow(text, text), y);
    }

    private static void draw(StringBuilder stream, PdfRow row, int y) {
        // Hex UTF-16BE cannot introduce PDF operators; BOM identifies the original Unicode text.
        stream.append("/Span << /ActualText <FEFF")
                .append(HexFormat.of().withUpperCase().formatHex(row.original().getBytes(StandardCharsets.UTF_16BE)))
                .append("> >> BDC\n");
        String text = row.visible();
        stream.append("1 0 0 1 45 ").append(y).append(" Tm\n(");
        for (byte b : text.getBytes(WIN_ANSI)) {
            int c = b & 0xff;
            if (c == '(' || c == ')' || c == '\\') stream.append('\\').append((char) c);
            else if (c < 32 || c > 126) stream.append('\\').append(String.format(Locale.ROOT, "%03o", c));
            else stream.append((char) c);
        }
        stream.append(") Tj\nEMC\n");
    }

    private static byte[] ascii(String text) { return text.getBytes(StandardCharsets.US_ASCII); }
}
