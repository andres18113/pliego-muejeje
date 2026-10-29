package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import com.pliego.modules.billing.gateway.BillingGateway;

class InvoiceDocumentStoreSelectionTest {
    @Test
    void defaultsToPostgresByteaWhenR2IsDisabled() {
        var properties = new R2StorageProperties(false, null, "http://invalid/path", "", null, null,
                "not-a-number", "../");
        var store = new BillingConfiguration().invoiceDocumentStore(properties,
                mock(BillingGateway.class), mock(R2RequestSigner.class), new R2PresignedUrlSigner());
        assertThat(store).isInstanceOf(DatabaseInvoiceDocumentStore.class);
    }

    @Test
    void selectsR2AdapterOnlyWhenExplicitlyEnabledAndValid() {
        var store = new BillingConfiguration().invoiceDocumentStore(properties(true),
                mock(BillingGateway.class), mock(R2RequestSigner.class), new R2PresignedUrlSigner());
        assertThat(store).isInstanceOf(R2InvoiceDocumentStore.class);
    }

    @Test
    void enabledR2WithMissingConfigurationFailsFastInSpanish() {
        var incomplete = new R2StorageProperties(true, null, null, "auto", null, null, "300", "invoices/");
        assertThatThrownBy(() -> new BillingConfiguration().invoiceDocumentStore(incomplete,
                mock(BillingGateway.class), mock(R2RequestSigner.class), new R2PresignedUrlSigner()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Configura PLIEGO_R2_BUCKET, ENDPOINT, REGION, credenciales, TTL y prefijo válidos.");
    }

    private static R2StorageProperties properties(boolean enabled) {
        return new R2StorageProperties(enabled, "billing-pliego",
                "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "auto",
                "fictional-access", "fictional-secret", "300", "invoices/");
    }
}
