package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import com.pliego.modules.billing.gateway.BillingGateway;

class R2StoragePropertiesTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner().withUserConfiguration(Config.class);

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(R2StorageProperties.class)
    static class Config { }

    @Test
    void defaultsDisabledWithAutoRegionTtlAndNoPrefix() {
        context.run(application -> {
            assertThat(application).hasNotFailed();
            var properties = application.getBean(R2StorageProperties.class);
            assertThat(properties.enabled()).isFalse();
            assertThat(properties.region()).isEqualTo("auto");
            assertThat(properties.ttlSeconds()).isEqualTo(300);
            assertThat(properties.keyPrefix()).isNull();
            assertThatCodeDoesNotValidate(properties);
        });
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t"})
    void enabledR2_withoutExplicitPrefix_failsStartup(String prefix) {
        var runner = enabledContext(false);
        if (prefix != null) runner = runner.withPropertyValues("pliego.r2.key-prefix=" + prefix);
        runner.run(application -> assertThat(application).hasFailed()
                .getFailure().hasRootCauseInstanceOf(IllegalArgumentException.class)
                .hasStackTraceContaining("prefijo"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"invoices/", "invoices/x/", "staging/invoices/", "invoices-x/"})
    void enabledR2_withoutProductionStorage_rejectsReservedOrNonDevelopmentPrefixes(String prefix) {
        enabledContext(false).withPropertyValues("pliego.r2.key-prefix=" + prefix)
                .run(application -> assertThat(application).hasFailed()
                        .getFailure().hasRootCauseInstanceOf(IllegalArgumentException.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"local-dev/invoices/", "invoices/x/"})
    void enabledR2_withProductionStorage_requiresExactProductionPrefix(String prefix) {
        enabledContext(true).withPropertyValues("pliego.r2.key-prefix=" + prefix)
                .run(application -> assertThat(application).hasFailed()
                        .getFailure().hasRootCauseInstanceOf(IllegalArgumentException.class));
    }

    @ParameterizedTest
    @CsvSource({"false,local-dev/invoices/", "true,invoices/"})
    void enabledR2_explicitEnvironmentScope_starts(boolean production, String prefix) {
        enabledContext(production).withPropertyValues("pliego.r2.key-prefix=" + prefix)
                .run(application -> assertThat(application).hasNotFailed()
                        .hasSingleBean(R2InvoiceDocumentStore.class));
    }

    private ApplicationContextRunner enabledContext(boolean production) {
        return context.withUserConfiguration(BillingConfiguration.class)
                .withBean(BillingGateway.class, () -> org.mockito.Mockito.mock(BillingGateway.class))
                .withBean(R2RequestSigner.class, R2RequestSigner::new)
                .withBean(R2PresignedUrlSigner.class, R2PresignedUrlSigner::new)
                .withPropertyValues("pliego.billing.enabled=false", "pliego.r2.enabled=true",
                        "pliego.r2.bucket=billing-pliego", "pliego.r2.endpoint=https://r2.example.invalid",
                        "pliego.r2.access-key-id=fictional-access", "pliego.r2.secret-access-key=fictional-secret",
                        "pliego.r2.production-storage=" + production);
    }

    @ParameterizedTest
    @CsvSource({"false,local-dev/invoices/", "true,invoices/"})
    void applicationYaml_bindsExplicitEnvironmentScope(boolean production, String prefix) {
        context.withInitializer(application -> {
            try {
                application.getEnvironment().getPropertySources().addLast(new org.springframework.boot.env.YamlPropertySourceLoader()
                        .load("application", new org.springframework.core.io.ClassPathResource("application.yml")).getFirst());
            } catch (java.io.IOException failure) { throw new java.io.UncheckedIOException(failure); }
            application.getEnvironment().getPropertySources().addFirst(new org.springframework.core.env.SystemEnvironmentPropertySource(
                    "r2-test-environment", java.util.Map.of(
                            "PLIEGO_R2_ENABLED", "true", "PLIEGO_R2_BUCKET", "billing-pliego",
                            "PLIEGO_R2_ENDPOINT", "https://r2.example.invalid",
                            "PLIEGO_R2_ACCESS_KEY_ID", "fictional-access", "PLIEGO_R2_SECRET_ACCESS_KEY", "fictional-secret",
                            "PLIEGO_R2_PRODUCTION_STORAGE", Boolean.toString(production), "PLIEGO_R2_KEY_PREFIX", prefix)));
        }).run(application -> {
            var properties = application.getBean(R2StorageProperties.class);
            properties.validate();
            assertThat(properties.productionStorage()).isEqualTo(production);
            assertThat(properties.keyPrefix()).isEqualTo(prefix);
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
                new R2StorageProperties(true, null, valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, "Bad bucket", valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), null, valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), "http://abc.r2.cloudflarestorage.com", "auto", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), "https://abc.r2.cloudflarestorage.com/path", "auto", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), "https://user@abc.r2.cloudflarestorage.com", "auto", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), "https://abc.r2.cloudflarestorage.com?x=y", "auto", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), " ", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), "auto\nregion", valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), null, valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), " ", valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), "bad\naccess", valid.secretAccessKey(), "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), "", "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), null, "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), "bad\nsecret", "300", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "0", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), null, "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "invalid", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "301", "invoices/", true),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "invoices", false),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "/invoices/", false),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", null, false),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "", false),
                new R2StorageProperties(true, valid.bucket(), valid.endpoint(), valid.region(), valid.accessKeyId(), valid.secretAccessKey(), "300", "a/../invoices/", false));
        for (var properties : invalid)
            assertThatThrownBy(properties::validate).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("R2");

        var disabled = new R2StorageProperties(false, "bad", "http://bad/path", "", "", "", "invalid", "../", false);
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
                "fictional-access-key", "fictional-secret", "300", "local-dev/invoices/", false);
    }

    private static void assertThatCodeDoesNotValidate(R2StorageProperties properties) {
        properties.validate();
    }
}
