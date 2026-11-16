package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class R2InvoiceObjectKeyTest {
    @Test
    void buildsContentAddressedPdfAndXmlKeysUnderConfiguredPrefix() {
        String checksum = "ab".repeat(32);
        assertThat(R2InvoiceObjectKey.forArtifact("invoices/", 42, checksum, "PDF"))
                .isEqualTo("invoices/42/" + checksum + ".pdf");
        assertThat(R2InvoiceObjectKey.forArtifact("local-dev/invoices/", 42, checksum, "XML"))
                .isEqualTo("local-dev/invoices/42/" + checksum + ".xml");
    }

    @Test
    void rejectsInvalidObjectKeyParts() {
        assertThatThrownBy(() -> R2InvoiceObjectKey.forArtifact("/invoices/", 42, "ab".repeat(32), "PDF"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> R2InvoiceObjectKey.forArtifact("invoices/", 0, "ab".repeat(32), "PDF"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> R2InvoiceObjectKey.forArtifact("invoices/", 42, "bad", "PDF"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> R2InvoiceObjectKey.forArtifact("invoices/", 42, "ab".repeat(32), "HTML"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
