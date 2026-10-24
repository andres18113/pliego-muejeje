package com.pliego.modules.identity.application;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class AuthReturnPathsTest {
    @ParameterizedTest
    @ValueSource(strings = {"/", "/cart", "/cart?source=edition#items", "/checkout", "/account/addresses/",
        "/catalog?que=An%C3%A1lisis&page=2", "/catalog/editions/250?from=%2Fofertas", "/ofertas", "/orders/123", "/biblioteca/42"})
    void keepsOnlySupportedRelativeRoutes(String path) {
        assertThat(AuthReturnPaths.safeOrNull(path)).isEqualTo(path);
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://evil.test/cart", "//evil.test/cart", "/admin", "/sign-in", "/cart/../admin",
        "/cart/%2e%2e/admin", "/%2fcart", "/cart\\evil", "/cart\n", "javascript:alert(1)", "/orders/0", "/cart/unknown"})
    void discardsUnsupportedDestinationsWithoutGrantingAccess(String path) {
        assertThat(AuthReturnPaths.safeOrNull(path)).isNull();
    }
}
