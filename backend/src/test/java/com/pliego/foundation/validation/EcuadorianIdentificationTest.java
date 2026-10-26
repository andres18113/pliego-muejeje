package com.pliego.foundation.validation;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

class EcuadorianIdentificationTest {
    @Test
    void matchesSharedSyntheticFixturesForCedulaAndRuc() throws Exception {
        var base = java.nio.file.Path.of(System.getProperty("basedir", ".")).toAbsolutePath();
        var fixture = base.resolve("../shared/validation/ec-identification-cases.json").normalize();
        if (!java.nio.file.Files.exists(fixture)) fixture = base.resolve("shared/validation/ec-identification-cases.json");
        var cases = tools.jackson.databind.json.JsonMapper.builder().build()
                .readTree(java.nio.file.Files.readString(fixture)).get("cases");
        assertThat(cases.size()).isGreaterThan(50);
        for (var entry : cases) {
            String value = entry.get("input").isNull() ? null : entry.get("input").asString();
            assertThat(EcuadorianIdentification.isValid(entry.get("type").asString(), value)).as(entry.get("id").asString())
                    .isEqualTo(entry.get("valid").asBoolean());
        }
    }

    @Test
    void companyRucsSkipModuloElevenButKeepProvinceThirdDigitAndEstablishmentChecks() {
        assertThat(EcuadorianIdentification.isValid("EC_RUC", "1760001210001")).isTrue();
        assertThat(EcuadorianIdentification.isValid("EC_RUC", "1790016918001")).isTrue();
        assertThat(EcuadorianIdentification.isValid("EC_RUC", "1710034065001")).isTrue();
        assertThat(EcuadorianIdentification.isValid("EC_RUC", "0090016918001")).isFalse();
        assertThat(EcuadorianIdentification.isValid("EC_RUC", "1770001210001")).isFalse();
        assertThat(EcuadorianIdentification.isValid("EC_RUC", "1790016918000")).isFalse();
        assertThat(EcuadorianIdentification.isValid("EC_RUC", "1760001210000")).isFalse();
        assertThat(EcuadorianIdentification.isValid("EC_RUC", "179001691800")).isFalse();
    }

    @Test
    void trimsOnlyExternalAsciiSpacesAndRejectsUnknownTypes() {
        assertThat(EcuadorianIdentification.normalized("  1710034065  ")).isEqualTo("1710034065");
        assertThat(EcuadorianIdentification.normalized("\t1710034065")).isEqualTo("\t1710034065");
        assertThat(EcuadorianIdentification.isValid("PASSPORT", "1710034065")).isFalse();
        assertThat(EcuadorianIdentification.isValid(null, "1710034065")).isFalse();
    }
}
