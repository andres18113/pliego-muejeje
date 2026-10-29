package com.pliego.modules.billing.application;

import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSString;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.JsonNode;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static com.pliego.modules.billing.application.InvoiceRenderer.*;

/** PLIEGO's deterministic purchase receipt layout. Values come directly from the immutable claim snapshot. */
final class AcademicInvoicePdf {
    private static final float PAGE_WIDTH = 595f;
    private static final float PAGE_HEIGHT = 842f;
    private static final float LEFT = 36f;
    private static final float RIGHT = 559f;
    private static final float CONTENT_WIDTH = RIGHT - LEFT;
    private static final float BODY_BOTTOM = 84f;
    private static final float HEADER_HEIGHT = 28f;
    private static final Color ULTRAMAR = new Color(0x28, 0x3d, 0xa8);
    private static final Color INK = new Color(0x25, 0x27, 0x40);
    private static final Color MUTED = new Color(0x59, 0x5a, 0x6e);
    private static final Color BORDER = new Color(0xd5, 0xd7, 0xe0);
    private static final float[] COLUMN_WIDTHS = {42f, 38f, 196f, 65f, 58f, 52f, 72f};
    private static final String[] COLUMN_HEADINGS = {"Código", "Cant.", "Descripción", "Precio unitario", "Descuento", "IVA %", "Precio total"};
    private static final Map<String, String> TAX_LABELS = Map.ofEntries(
            Map.entry("0", "IVA 0%"), Map.entry("2", "IVA 12%"), Map.entry("3", "IVA 14%"),
            Map.entry("4", "IVA 15%"), Map.entry("5", "IVA 5%"), Map.entry("6", "No objeto de IVA"),
            Map.entry("7", "Exento de IVA"), Map.entry("8", "IVA 8%"));
    private AcademicInvoicePdf() { }

    static byte[] render(JsonNode snapshot) throws Exception {
        try (PDDocument document = new PDDocument()) {
            document.getDocument().setVersion(1.4f);
            setDeterministicDocumentId(document);
            var regular = loadFont(document, "/billing/fonts/Roboto-Regular.ttf");
            var medium = loadFont(document, "/billing/fonts/Roboto-Medium.ttf");
            var bold = loadFont(document, "/billing/fonts/Roboto-Bold.ttf");
            var logo = PDImageXObject.createFromByteArray(document,
                    resourceBytes("/billing/brand/pliego-logo.png"), "pliego-logo.png");
            Layout layout = new Layout(document, regular, medium, bold, logo, snapshot);
            layout.firstPage();
            layout.items();
            layout.summary();
            layout.footers();

            var information = document.getDocumentInformation();
            information.setTitle("Comprobante de compra " + text(snapshot, "documentNumber"));
            information.setProducer("PLIEGO");
            var output = new ByteArrayOutputStream();
            document.save(output);
            return output.toByteArray();
        }
    }

    private static PDType0Font loadFont(PDDocument document, String path) throws Exception {
        try (InputStream source = resource(path)) {
            // PDFBox 3.0.8 derives the subset tag deterministically from its glyph-to-CID map.
            return PDType0Font.load(document, source, true);
        }
    }

    private static InputStream resource(String path) throws Exception {
        InputStream source = AcademicInvoicePdf.class.getResourceAsStream(path);
        if (source == null) throw new IllegalStateException("No se encontró un recurso de facturación");
        return source;
    }

    private static byte[] resourceBytes(String path) throws Exception {
        try (InputStream source = resource(path)) { return source.readAllBytes(); }
    }

    private static void setDeterministicDocumentId(PDDocument document) {
        byte[] id = HexFormat.of().parseHex("504c4945474f2d41434144454d494341");
        var values = new COSArray();
        var first = new COSString(id);
        first.setForceHexForm(true);
        var second = new COSString(id);
        second.setForceHexForm(true);
        values.add(first);
        values.add(second);
        document.getDocument().setDocumentID(values);
    }

    private static final class Layout {
        private final PDDocument document;
        private final PDType0Font regular;
        private final PDType0Font medium;
        private final PDType0Font bold;
        private final PDImageXObject logo;
        private final JsonNode snapshot;
        private final List<PDPage> pages = new ArrayList<>();
        private PDPage page;
        private float y;

        private Layout(PDDocument document, PDType0Font regular, PDType0Font medium, PDType0Font bold,
                PDImageXObject logo, JsonNode snapshot) {
            this.document = document;
            this.regular = regular;
            this.medium = medium;
            this.bold = bold;
            this.logo = logo;
            this.snapshot = snapshot;
        }

        private void firstPage() throws Exception {
            newPage();
            float itemsTableTop;
            try (var stream = stream()) {
                float headerTop = PAGE_HEIGHT - 36f;
                float logoBottom = headerTop - 27f;
                float siteBaseline = headerTop - 40f;
                stream.drawImage(logo, LEFT, logoBottom, 104f, 24.2f);
                drawText(stream, regular, 8.2f, LEFT, siteBaseline, MUTED, "pliegolibros.com");

                float boxX = 304f;
                float boxWidth = 255f;
                float boxPadding = 12f;
                float textX = boxX + boxPadding;
                float titleY = headerTop - 17f;
                float documentY = titleY - 22f;
                float orderY = documentY - 18f;
                float issueDateY = orderY - 18f;
                float boxBottom = issueDateY - boxPadding;
                float boxHeight = headerTop - boxBottom;
                roundedBox(stream, boxX, boxBottom, boxWidth, boxHeight, Color.WHITE, BORDER);
                letterSpaced(stream, bold, 12f, textX, titleY, ULTRAMAR, "COMPROBANTE DE COMPRA", 0.3f);
                drawText(stream, bold, 10.5f, textX, documentY, INK, "N.° " + text(snapshot, "documentNumber"));
                drawText(stream, regular, 8.5f, textX, orderY, INK, "Pedido: " + text(snapshot, "orderId"));
                drawText(stream, regular, 8.5f, textX, issueDateY, INK, "Fecha de emisión: " + date(snapshot));

                float logoBlockBottom = siteBaseline - 2.5f;
                float logoBlockHeight = headerTop - logoBlockBottom;
                float headerRowHeight = Math.max(logoBlockHeight, boxHeight);
                itemsTableTop = drawCustomerBox(stream, headerTop - headerRowHeight - 20f);
            }
            tableHeader(itemsTableTop);
        }

        private float drawCustomerBox(PDPageContentStream stream, float boxTop) throws Exception {
            float leftX = LEFT + 12f;
            float rightX = LEFT + 267f;
            float valueOffset = 100f;
            float leftValueX = leftX + valueOffset;
            float rightValueX = rightX + valueOffset;
            float valueWidth = 144f;
            float startY = boxTop - 36f;
            float lineHeight = 9f;

            List<String> nameLines = wrap(text(snapshot, "buyerName"), 7.5f, valueWidth);
            List<String> identityLines = wrap(text(snapshot, "identityNumber"), 7.5f, valueWidth);
            float firstRowHeight = Math.max(nameLines.size(), identityLines.size()) * lineHeight;
            float secondY = startY - firstRowHeight - 10f;
            String email = optional(snapshot, "buyerEmail");
            List<String> emailLines = email.isEmpty() ? List.of() : wrap(email, 7.5f, valueWidth);
            float addressWidth = emailLines.isEmpty() ? CONTENT_WIDTH - valueOffset - 24f : valueWidth;
            List<String> addressLines = wrap(address(snapshot.path("billingAddress")), 7.5f, addressWidth);
            float secondRowHeight = Math.max(addressLines.size(), emailLines.size()) * lineHeight;
            float boxBottom = secondY - secondRowHeight - 12f;
            float boxHeight = boxTop - boxBottom;

            roundedBox(stream, LEFT, boxBottom, CONTENT_WIDTH, boxHeight, Color.WHITE, BORDER);
            drawText(stream, bold, 9.5f, leftX, boxTop - 17f, ULTRAMAR, "Datos del cliente");
            drawCustomerField(stream, leftX, leftValueX, startY, "Nombre / Razón social", nameLines, 7.1f, lineHeight);
            drawCustomerField(stream, rightX, rightValueX, startY, ruc(snapshot) ? "RUC" : "Cédula", identityLines, 7.1f, lineHeight);
            drawCustomerField(stream, leftX, leftValueX, secondY, "Dirección", addressLines, 7.5f, lineHeight);
            if (!emailLines.isEmpty()) drawCustomerField(stream, rightX, rightValueX, secondY, "Correo", emailLines, 7.1f, lineHeight);
            return boxBottom - 14f;
        }

        private void drawCustomerField(PDPageContentStream stream, float labelX, float valueX, float y,
                String label, List<String> values, float size, float lineHeight) throws Exception {
            drawText(stream, medium, 7f, labelX, y, MUTED, label);
            for (int index = 0; index < values.size(); index++)
                drawText(stream, regular, size, valueX, y - index * lineHeight, INK, values.get(index));
        }

        private void items() throws Exception {
            for (JsonNode item : snapshot.path("items")) {
                List<String> cells = List.of(text(item, "invoiceItemId"), text(item, "quantity"),
                        text(item, "description"), amount(item, "originalUnitPrice"), amount(item, "discountAmount"),
                        amount(item, "taxRate"), amount(item, "subtotal"));
                List<List<String>> lines = new ArrayList<>();
                float height = 21f;
                for (int i = 0; i < cells.size(); i++) {
                    List<String> wrapped = wrap(cells.get(i), i == 2 ? 8f : 7.3f, COLUMN_WIDTHS[i] - 8f);
                    lines.add(wrapped);
                    height = Math.max(height, wrapped.size() * 10f + 8f);
                }
                if (y - height < BODY_BOTTOM) {
                    continuationPage();
                }
                try (var stream = stream()) {
                    drawTableRow(stream, lines, height, false);
                }
                y -= height;
            }
        }

        private void summary() throws Exception {
            float leftHeight = additionalHeight();
            float rightHeight = totalsHeight();
            float height = Math.max(leftHeight, rightHeight);
            if (y - height - 14f < BODY_BOTTOM) {
                summaryPage();
            } else {
                y -= 14f;
            }
            float bottom = y - height;
            try (var stream = stream()) {
                roundedBox(stream, LEFT, bottom, 254f, height, Color.WHITE, BORDER);
                roundedBox(stream, 304f, bottom, 255f, height, Color.WHITE, BORDER);
                drawAdditional(stream, LEFT + 12f, y - 18f, 230f);
                drawTotals(stream, 316f, y - 18f, 231f);
            }
        }

        private float additionalHeight() {
            int rows = 1;
            JsonNode payment = snapshot.path("payment");
            if (payment.path("method").isTextual()) rows++;
            return 18f + rows * 14f + 10f + 15f + 14f;
        }

        private float totalsHeight() {
            return 18f + (snapshot.path("taxes").size() + 5) * 15f + 22f;
        }

        private void drawAdditional(PDPageContentStream stream, float x, float top, float width) throws Exception {
            drawText(stream, bold, 9f, x, top, ULTRAMAR, "Información adicional");
            float rowY = top - 18f;
            smallFact(stream, x, rowY, width, "Moneda", text(snapshot, "currency")); rowY -= 14f;
            drawText(stream, medium, 8f, x, rowY - 2f, MUTED, "Forma de pago"); rowY -= 17f;
            JsonNode payment = snapshot.path("payment");
            String method = paymentLabel(optional(payment, "method"));
            if (!method.isEmpty()) {
                smallFact(stream, x, rowY, width, "Método", method);
                rowY -= 14f;
            }
            String paymentAmount = payment.hasNonNull("amount") ? amount(payment, "amount") : amount(snapshot, "total");
            smallFact(stream, x, rowY, width, method.isEmpty() ? "Monto del documento" : "Monto registrado",
                    paymentAmount + " " + text(snapshot, "currency"));
        }

        private void drawTotals(PDPageContentStream stream, float x, float top, float width) throws Exception {
            drawText(stream, bold, 9f, x, top, ULTRAMAR, "Resumen de valores");
            float rowY = top - 18f;
            for (JsonNode tax : snapshot.path("taxes")) {
                String code = text(tax, "taxPercentageCode");
                String label = TAX_LABELS.getOrDefault(code, "IVA código " + code);
                totalFact(stream, x, rowY, width, "Subtotal " + label, amount(tax, "taxableBase"), false);
                rowY -= 15f;
            }
            totalFact(stream, x, rowY, width, "Subtotal sin impuestos", amount(snapshot, "subtotal"), false); rowY -= 15f;
            totalFact(stream, x, rowY, width, "Total descuento", amount(snapshot, "totalDiscount"), false); rowY -= 15f;
            totalFact(stream, x, rowY, width, "IVA", amount(snapshot, "taxTotal"), false); rowY -= 15f;
            totalFact(stream, x, rowY, width, "Envío", amount(snapshot, "shippingAmount"), false); rowY -= 17f;
            line(stream, x, rowY + 6f, x + width, rowY + 6f, BORDER, 0.7f);
            totalFact(stream, x, rowY - 2f, width, "VALOR TOTAL", amount(snapshot, "total") + " " + text(snapshot, "currency"), true);
        }

        private void continuationPage() throws Exception {
            newPage();
            continuationHeader();
            tableHeader(778f);
        }

        private void summaryPage() throws Exception {
            newPage();
            continuationHeader();
            y = 772f;
        }

        private void continuationHeader() throws Exception {
            try (var stream = stream()) {
                drawText(stream, medium, 9f, LEFT, 806f, ULTRAMAR,
                        "Comprobante de compra · N.° " + text(snapshot, "documentNumber"));
                drawText(stream, regular, 8f, LEFT, 791f, MUTED, "Pedido: " + text(snapshot, "orderId"));
            }
        }

        private void tableHeader(float top) throws Exception {
            y = top;
            try (var stream = stream()) {
                List<List<String>> headings = new ArrayList<>();
                for (int i = 0; i < COLUMN_HEADINGS.length; i++)
                    headings.add(List.of(COLUMN_HEADINGS[i].split("\n")));
                drawTableRow(stream, headings, HEADER_HEIGHT, true);
            }
            y = top - HEADER_HEIGHT;
        }

        private void drawTableRow(PDPageContentStream stream, List<List<String>> cellLines, float height,
                boolean header) throws Exception {
            float rowTop = y;
            stream.saveGraphicsState();
            stream.setLineWidth(0.55f);
            stream.setStrokingColor(BORDER);
            if (header) stream.setNonStrokingColor(ULTRAMAR);
            else stream.setNonStrokingColor(Color.WHITE);
            stream.addRect(LEFT, rowTop - height, CONTENT_WIDTH, height);
            if (header) stream.fillAndStroke(); else stream.stroke();
            float x = LEFT;
            for (int i = 0; i < COLUMN_WIDTHS.length; i++) {
                float width = COLUMN_WIDTHS[i];
                if (i > 0) line(stream, x, rowTop, x, rowTop - height, BORDER, 0.5f);
                List<String> lines = cellLines.get(i);
                float fontSize = header ? 7f : (i == 2 ? 8f : 7.1f);
                float headerLineHeight = 8.5f;
                float headerBlockHeight = fontSize * 0.7f + Math.max(0, lines.size() - 1) * headerLineHeight;
                float baseline = header
                        ? rowTop - (height - headerBlockHeight) / 2f - fontSize * 0.7f
                        : rowTop - 11f;
                for (String value : lines) {
                    boolean numeric = !header && i != 0 && i != 2;
                    if (header) centered(stream, bold, fontSize, x + 3f, width - 6f,
                            baseline, Color.WHITE, value);
                    else if (numeric) rightText(stream, regular, fontSize, x + 4f, baseline,
                            width - 8f, INK, value);
                    else drawText(stream, regular, fontSize, x + 4f, baseline, INK, value);
                    baseline -= header ? headerLineHeight : 10f;
                }
                x += width;
            }
            stream.restoreGraphicsState();
        }

        private void footers() throws Exception {
            int totalPages = pages.size();
            for (int index = 0; index < totalPages; index++) {
                PDPage footerPage = pages.get(index);
                try (PDPageContentStream stream = new PDPageContentStream(document, footerPage,
                        PDPageContentStream.AppendMode.APPEND, true, true)) {
                    drawText(stream, regular, 8f, LEFT, 34f, MUTED,
                            "Comprobante sin validez tributaria. No es una factura electrónica autorizada por el SRI.");
                    rightText(stream, regular, 8f, LEFT, 34f, CONTENT_WIDTH, MUTED,
                            "Página " + (index + 1) + " de " + totalPages);
                }
            }
        }

        private void newPage() {
            page = new PDPage(new PDRectangle(PAGE_WIDTH, PAGE_HEIGHT));
            document.addPage(page);
            pages.add(page);
            y = PAGE_HEIGHT - 36f;
        }

        private PDPageContentStream stream() throws Exception {
            return new PDPageContentStream(document, page, PDPageContentStream.AppendMode.APPEND, true, true);
        }

        private void smallFact(PDPageContentStream stream, float x, float y, float width,
                String label, String value) throws Exception {
            String display = value == null || value.isBlank() ? "—" : value;
            float labelWidth = 80f;
            drawText(stream, regular, 7.2f, x, y, MUTED, label);
            List<String> wrapped = wrap(display, 7.2f, width - labelWidth);
            for (int i = 0; i < wrapped.size(); i++)
                drawText(stream, regular, 7.2f, x + labelWidth, y - i * 9f, INK, wrapped.get(i));
        }

        private void totalFact(PDPageContentStream stream, float x, float y, float width,
                String label, String value, boolean strong) throws Exception {
            PDType0Font font = strong ? bold : regular;
            Color color = strong ? INK : MUTED;
            float size = strong ? 8.2f : 7.3f;
            drawText(stream, font, size, x, y, color, label);
            rightText(stream, font, size, x, y, width, color, value);
        }

        private List<String> wrap(String value, float size, float width) throws Exception {
            return wrapText(value, regular, size, width);
        }
    }

    private static void roundedBox(PDPageContentStream stream, float x, float y, float width,
            float height, Color fill, Color border) throws Exception {
        float radius = Math.min(8f, Math.min(width, height) / 2f);
        float c = radius * 0.55228475f;
        stream.saveGraphicsState();
        stream.setLineWidth(0.7f);
        stream.setNonStrokingColor(fill);
        stream.setStrokingColor(border);
        stream.moveTo(x + radius, y);
        stream.lineTo(x + width - radius, y);
        stream.curveTo(x + width - radius + c, y, x + width, y + radius - c, x + width, y + radius);
        stream.lineTo(x + width, y + height - radius);
        stream.curveTo(x + width, y + height - radius + c, x + width - radius + c, y + height,
                x + width - radius, y + height);
        stream.lineTo(x + radius, y + height);
        stream.curveTo(x + radius - c, y + height, x, y + height - radius + c, x, y + height - radius);
        stream.lineTo(x, y + radius);
        stream.curveTo(x, y + radius - c, x + radius - c, y, x + radius, y);
        stream.closeAndFillAndStroke();
        stream.restoreGraphicsState();
    }

    private static void line(PDPageContentStream stream, float x1, float y1, float x2, float y2,
            Color color, float width) throws Exception {
        stream.saveGraphicsState();
        stream.setStrokingColor(color);
        stream.setLineWidth(width);
        stream.moveTo(x1, y1);
        stream.lineTo(x2, y2);
        stream.stroke();
        stream.restoreGraphicsState();
    }

    private static void drawText(PDPageContentStream stream, PDType0Font font, float size, float x,
            float y, Color color, String value) throws Exception {
        String safe = safeText(font, value);
        stream.beginText();
        stream.setCharacterSpacing(0f);
        stream.setNonStrokingColor(color);
        stream.setFont(font, size);
        stream.newLineAtOffset(x, y);
        stream.showText(safe);
        stream.endText();
    }

    private static void letterSpaced(PDPageContentStream stream, PDType0Font font, float size,
            float x, float y, Color color, String value, float spacing) throws Exception {
        stream.beginText();
        stream.setNonStrokingColor(color);
        stream.setFont(font, size);
        stream.setCharacterSpacing(spacing);
        stream.newLineAtOffset(x, y);
        stream.showText(safeText(font, value));
        stream.endText();
    }

    private static void centered(PDPageContentStream stream, PDType0Font font, float size,
            float x, float width, float y, Color color, String value) throws Exception {
        String safe = safeText(font, value);
        float textWidth = font.getStringWidth(safe) / 1000f * size;
        drawText(stream, font, size, x + Math.max(0f, (width - textWidth) / 2f), y, color, safe);
    }

    private static void rightText(PDPageContentStream stream, PDType0Font font, float size,
            float x, float y, float width, Color color, String value) throws Exception {
        String safe = safeText(font, value);
        float textWidth = font.getStringWidth(safe) / 1000f * size;
        drawText(stream, font, size, x + Math.max(0f, width - textWidth), y, color, safe);
    }

    private static List<String> wrapText(String value, PDType0Font font, float size, float width) throws Exception {
        String clean = safeText(font, value).replaceAll("\\s+", " ").strip();
        if (clean.isEmpty()) return List.of("");
        var result = new ArrayList<String>();
        StringBuilder line = new StringBuilder();
        for (String word : clean.split(" ")) {
            String candidate = line.isEmpty() ? word : line + " " + word;
            if (measure(font, size, candidate) <= width) {
                line.setLength(0);
                line.append(candidate);
                continue;
            }
            if (!line.isEmpty()) {
                result.add(line.toString());
                line.setLength(0);
            }
            if (measure(font, size, word) <= width) {
                line.append(word);
                continue;
            }
            StringBuilder chunk = new StringBuilder();
            for (int offset = 0; offset < word.length();) {
                int codePoint = word.codePointAt(offset);
                String character = new String(Character.toChars(codePoint));
                String next = chunk + character;
                if (!chunk.isEmpty() && measure(font, size, next) > width) {
                    result.add(chunk.toString());
                    chunk.setLength(0);
                }
                chunk.append(character);
                offset += Character.charCount(codePoint);
            }
            line.append(chunk);
        }
        if (!line.isEmpty()) result.add(line.toString());
        return result;
    }

    private static float measure(PDType0Font font, float size, String value) throws Exception {
        return font.getStringWidth(value) / 1000f * size;
    }

    /** Roboto covers the Latin text used here; any missing Unicode code point becomes a visible question mark. */
    private static String safeText(PDType0Font font, String value) throws Exception {
        if (value == null || value.isEmpty()) return "";
        StringBuilder safe = new StringBuilder();
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            if (Character.isISOControl(codePoint) || codePoint == 0x2028 || codePoint == 0x2029) {
                safe.append(' ');
            } else {
                String character = new String(Character.toChars(codePoint));
                try {
                    font.encode(character);
                    safe.append(character);
                } catch (IllegalArgumentException missingGlyph) {
                    safe.append('?');
                }
            }
            offset += Character.charCount(codePoint);
        }
        return safe.toString();
    }

    private static String paymentLabel(String method) {
        return switch (method) {
            case "CARD" -> "Tarjeta";
            case "TRANSFER" -> "Transferencia";
            default -> "";
        };
    }
}
