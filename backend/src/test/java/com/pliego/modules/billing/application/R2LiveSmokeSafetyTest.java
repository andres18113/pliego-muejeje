package com.pliego.modules.billing.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class R2LiveSmokeSafetyTest {
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "invoices/", "invoices/x/", "staging/invoices/"})
    void smoke_withoutExplicitDevelopmentPrefix_refusesBeforeClientConstruction(String prefix) {
        assertThatThrownBy(() -> R2LiveSmokeTest.requireSmokePrefix(prefix, null))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("prefijo explícito local-dev/");
    }

    @ParameterizedTest
    @ValueSource(strings = {"true", "TRUE", "invalid"})
    void smoke_withProductionStorage_refusesBeforeClientConstruction(String productionStorage) {
        assertThatThrownBy(() -> R2LiveSmokeTest.requireSmokePrefix("local-dev/invoices/", productionStorage))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("producción desactivado");
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"false"})
    void smoke_withExplicitDevelopmentPrefix_acceptsWithoutRunningLiveTest(String productionStorage) {
        assertThat(R2LiveSmokeTest.requireSmokePrefix("local-dev/invoices/", productionStorage))
                .isEqualTo("local-dev/invoices/");
    }
}
