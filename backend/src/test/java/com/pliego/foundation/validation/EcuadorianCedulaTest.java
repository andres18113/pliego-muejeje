package com.pliego.foundation.validation;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

class EcuadorianCedulaTest {
    private boolean valid(String value) throws Exception {
        return EcuadorianCedula.isValid(value);
    }

    @Test
    void acceptsSyntheticChecksumsIncludingLeadingZerosAndUnrestrictedPrefixes() throws Exception {
        for (String prefix : new String[]{"001234567", "991234567", "179876543"}) {
            int sum = 0;
            for (int i = 0; i < 9; i++) {
                int product = (prefix.charAt(i) - '0') * (i % 2 == 0 ? 2 : 1);
                sum += product > 9 ? product - 9 : product;
            }
            String value = prefix + (10 - sum % 10) % 10;
            assertThat(valid(value)).isTrue();
            assertThat(valid("  " + value + "  ")).isTrue();
            assertThat(valid(value.substring(0, 9) + ((value.charAt(9) - '0' + 1) % 10))).isFalse();
        }
    }

    @Test
    void rejectsMissingMalformedUnicodeAndRepeatedDigits() throws Exception {
        assertThat(valid(null)).isFalse();
        for (String value : new String[]{"", " ", "123", "001234567890", "00123 5674", "+012345674",
                "00123456.4", "00123456a4", "００１２３４５６７４", "٠٠١٢٣٤٥٦٧٤"}) {
            assertThat(valid(value)).isFalse();
        }
        for (int i = 0; i < 10; i++) assertThat(valid(String.valueOf(i).repeat(10))).isFalse();
    }
    @Test
    void matchesSharedSyntheticFixturesAndNormalization() throws Exception {
        var base = java.nio.file.Path.of(System.getProperty("basedir", ".")).toAbsolutePath();
        var fixture = base.resolve("../shared/validation/cedula-cases.json").normalize();
        if (!java.nio.file.Files.exists(fixture)) fixture = base.resolve("shared/validation/cedula-cases.json");
        var cases = tools.jackson.databind.json.JsonMapper.builder().build()
                .readTree(java.nio.file.Files.readString(fixture)).get("cases");
        for (var entry : cases) {
            String value = entry.get("input").isNull() ? null : entry.get("input").asString();
            String normalized = entry.get("normalized").isNull() ? null : entry.get("normalized").asString();
            assertThat(EcuadorianCedula.isValid(value)).as(entry.get("id").asString())
                    .isEqualTo(entry.get("valid").asBoolean());
            assertThat(EcuadorianCedula.normalized(value)).as(entry.get("id").asString()).isEqualTo(normalized);
        }
    }
}
