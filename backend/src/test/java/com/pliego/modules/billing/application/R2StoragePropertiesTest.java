package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

class R2StoragePropertiesTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner().withUserConfiguration(Config.class);

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(R2StorageProperties.class)
    static class Config { }

    @Test
    void defaultsDisabledWithAutoRegionTtlAndInvoicePrefix() {
        context.run(application -> {
            assertThat(application).hasNotFailed();
            var properties = application.getBean(R2StorageProperties.class);
            assertThat(properties.enabled()).isFalse();
            assertThat(properties.region()).isEqualTo("auto");
            assertThat(properties.ttlSeconds()).isEqualTo(300);
            assertThat(properties.keyPrefix()).isEqualTo("invoices/");
            assertThatCodeDoesNotValidate(properties);
        });
    }

    @Test
    void bindsTheR2EnvironmentPropertySet() {
        context.withPropertyValues(
                "pliego.r2.enabled=true", "pliego.r2.bucket=billing-pliego",
                "pliego.r2.endpoint=https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
                "pliego.r2.region=auto", "pliego.r2.access-key-id=fictional-access",
                "pliego.r2.secret-access-key=fictional-secret", "pliego.r2.presign-ttl-seconds=240",
                "pliego.r2.key-prefix=local-dev/invoices/").run(application -> {
            assertThat(application).hasNotFailed();
            var properties = application.getBean(R2StorageProperties.class);
            properties.validate();
            assertThat(properties.enabled()).isTrue();
            assertThat(properties.ttlSeconds()).isEqualTo(240);
            assertThat(properties.keyPrefix()).isEqualTo("local-dev/invoices/");
        });
        context.withPropertyValues("pliego.r2.enabled=maybe").run(application -> assertThat(application).hasFailed());
    }

    @Test
    void validatesEveryRequiredSettingOnlyWhenEnabled() {
        var valid = valid();
        List<R2StorageProperties> invalid = List.of(
                new R2StorageProperties(true, null, valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, "Bad bucket", valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), null, valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), "http://abc.r2.cloudflarestorage.com", "auto", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), "https://abc.r2.cloudflarestorage.com/path", "auto", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), "https://user@abc.r2.cloudflarestorage.com", "auto", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), "https://abc.r2.cloudflarestorage.com?x=y", "auto", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), " ", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), "auto\nregion", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), null, valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), " ", valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), "bad\naccess", valid.secretAccessKey(), "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), "", "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), null, "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), "bad\nsecret", "300", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "0", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), null, "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "invalid", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "301", "invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "/invoices/"),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", null),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", ""),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "a/../invoices/"));
        for (var properties : invalid)
            assertThatThrownBy(properties::validate).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("R2");

        var disabled = new R2StorageProperties(false, "bad", "http://bad/path", "", "", "", "invalid", "../");
        assertThatCodeDoesNotValidate(disabled);
    }

    @Test
    void validR2SettingsAcceptPathStyleEndpointAndRedactSecret() {
        var properties = valid();
        properties.validate();
        assertThat(properties.endpoint()).isEqualTo("https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
        assertThat(properties.toString()).doesNotContain("fictional-secret").contains("REDACTED");
    }

    private static R2StorageProperties valid() {
        return new R2StorageProperties(true, "billing-pliego",
                "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "auto",
                "fictional-access-key", "fictional-secret", "300", "local-dev/invoices/");
    }

    private static void assertThatCodeDoesNotValidate(R2StorageProperties properties) {
        properties.validate();
    }
}
