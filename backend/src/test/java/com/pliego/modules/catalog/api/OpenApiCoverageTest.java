package com.pliego.modules.catalog.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * Guards REST/OpenAPI contract consistency: every endpoint method carries an
 * operation summary, every controller carries a tag, and only the two public
 * controllers omit the bearer security requirement.
 */
class OpenApiCoverageTest {

    private static final List<Class<?>> CONTROLLERS = List.of(
            com.pliego.modules.identity.api.AuthController.class,
            com.pliego.modules.customer.api.CustomerController.class,
            com.pliego.modules.customer.api.AdminCustomerController.class,
            com.pliego.modules.catalog.api.CatalogController.class,
            com.pliego.modules.catalog.api.AdminCatalogController.class,
            com.pliego.modules.inventory.api.AdminInventoryController.class,
            com.pliego.modules.cart.api.CartController.class,
            com.pliego.modules.sales.api.CheckoutController.class,
            com.pliego.modules.sales.api.CustomerOrderController.class,
            com.pliego.modules.sales.api.AdminOrderController.class);

    private static boolean isEndpoint(Method method) {
        return method.isAnnotationPresent(GetMapping.class)
                || method.isAnnotationPresent(PostMapping.class)
                || method.isAnnotationPresent(PutMapping.class)
                || method.isAnnotationPresent(PatchMapping.class)
                || method.isAnnotationPresent(DeleteMapping.class);
    }

    @Test
    void everyEndpointDeclaresAnOperation() {
        int endpoints = 0;
        for (Class<?> controller : CONTROLLERS) {
            for (Method method : controller.getDeclaredMethods()) {
                if (isEndpoint(method)) {
                    endpoints++;
                    assertThat(method.isAnnotationPresent(Operation.class))
                            .as("%s#%s lacks @Operation", controller.getSimpleName(), method.getName())
                            .isTrue();
                }
            }
        }
        assertThat(endpoints).as("approved REST total (50 endpoints)").isEqualTo(50);
    }

    @Test
    void everyControllerDeclaresATag() {
        for (Class<?> controller : CONTROLLERS) {
            assertThat(controller.isAnnotationPresent(Tag.class))
                    .as("%s lacks @Tag", controller.getSimpleName())
                    .isTrue();
        }
    }

    @Test
    void onlyPublicControllersOmitBearerRequirement() {
        for (Class<?> controller : CONTROLLERS) {
            boolean secured = controller.isAnnotationPresent(SecurityRequirement.class);
            String name = controller.getSimpleName();
            if (name.equals("AuthController") || name.equals("CatalogController")) {
                assertThat(secured).as("%s must stay public", name).isFalse();
            } else {
                assertThat(secured).as("%s must require bearerJwt", name).isTrue();
            }
        }
    }
}
