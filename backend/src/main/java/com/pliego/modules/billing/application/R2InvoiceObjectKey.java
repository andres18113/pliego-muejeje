package com.pliego.modules.billing.application;

/** Content-addressed object key: <prefix><invoiceId>/<sha256>.<pdf|xml>. */
public final class R2InvoiceObjectKey {
    private R2InvoiceObjectKey() { }

    public static String forArtifact(String prefix, long invoiceId, String checksum, String type) {
        if (prefix == null || prefix.isBlank() || prefix.startsWith("/") || !prefix.endsWith("/") || prefix.contains("..")
                || prefix.contains("\\") || !prefix.matches("[A-Za-z0-9._/-]+")
                || invoiceId < 1 || checksum == null || !checksum.matches("[0-9a-f]{64}")
                || (!"PDF".equals(type) && !"XML".equals(type)))
            throw new IllegalArgumentException("Clave de objeto R2 inválida.");
        return prefix + invoiceId + "/" + checksum + "." + type.toLowerCase(java.util.Locale.ROOT);
    }
}
