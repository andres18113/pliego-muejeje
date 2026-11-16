package com.pliego.modules.billing.application;

/** Shared guard for object requests and presigning; keys and credentials never appear in failures. */
final class R2KeyScope {
    private R2KeyScope() { }

    static void require(R2StorageProperties properties, String objectKey) {
        properties.validate();
        if (!properties.enabled()) throw new IllegalArgumentException("El acceso R2 está deshabilitado.");
        if (objectKey == null || objectKey.isBlank() || objectKey.startsWith("/") || objectKey.contains("..")
                || objectKey.contains("\\") || objectKey.contains("?"))
            throw new IllegalArgumentException("Clave de objeto R2 inválida.");
        if (!objectKey.startsWith(properties.keyPrefix())) throw new OutsidePrefixException();
    }

    static final class OutsidePrefixException extends IllegalArgumentException {
        OutsidePrefixException() { super("La clave R2 está fuera del prefijo configurado."); }
    }
}
