package com.pliego.modules.customer.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.pliego.foundation.database.DatabaseException;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.customer.gateway.CustomerGateway;
import com.pliego.modules.customer.gateway.CustomerGateway.AddressData;
import com.pliego.modules.customer.gateway.CustomerGateway.CustomerAddress;
import com.pliego.modules.customer.gateway.CustomerGateway.CustomerProfile;
import com.pliego.modules.customer.application.CustomerFavorites.Favorite;
import com.pliego.modules.customer.application.CustomerFavorites.Page;
import com.pliego.modules.customer.application.CustomerFavorites.Status;

@org.springframework.test.context.TestPropertySource(properties = "pliego.mail.enabled=false")
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i3_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@org.springframework.test.context.event.RecordApplicationEvents
@Import(CustomerApiIntegrationTest.TestConfigurationForCustomerApi.class)
class CustomerApiIntegrationTest {

    private static final String ADDRESS = """
            {"alias":"Casa","recipient":"Ana Pérez","line1":"Av. Principal 123","line2":null,
             "city":"Quito","province":"Pichincha","countryCode":"EC","postalCode":null,
             "reference":"Frente al parque","phone":"+59325550134","makePrimary":true}
            """;
    private static final String ADDRESS_UPDATE = """
            {"alias":"Trabajo","recipient":"Ana Pérez","line1":"Av. Principal 123","line2":"Oficina 3",
             "city":"Quito","province":"Pichincha","countryCode":"EC","postalCode":"170101",
             "reference":null,"phone":"+59325550134"}
            """;

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtTokenIssuer tokenIssuer;

    @Autowired
    DatabaseExceptionTranslator exceptionTranslator;

    @Autowired
    FakeCustomerGateway gateway;

    @Autowired
    org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    @Autowired
    org.springframework.test.context.event.ApplicationEvents events;

    @BeforeEach
    void resetEmailActions() {
        org.mockito.Mockito.reset(emailActions);
    }

    @org.springframework.test.context.bean.override.mockito.MockitoBean
    com.pliego.modules.identity.application.EmailActionService emailActions;

    @BeforeEach
    void resetGateway() {
        gateway.reset();
    }

    @Test
    void getsAndReplacesOwnProfileUsingOnlyJwtSubject() throws Exception {
        mvc.perform(get("/api/v1/me").header("Authorization", customerToken("100")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.customerId").value("87"))
                .andExpect(jsonPath("$.email").value("ana@example.com"))
                .andExpect(jsonPath("$.firstNames").value("Ana María"));
        assertEquals(100L, gateway.lastActorUserId);

        mvc.perform(put("/api/v1/me").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":\"0\",\"firstNames\":\"Ana\",\"lastNames\":\"Pérez\",\"phone\":null}"))
                .andExpect(status().isNoContent());
        assertEquals(100L, gateway.lastActorUserId);
        assertEquals("Ana", gateway.profile.firstNames());
        assertEquals(null, gateway.profile.phone());

        mvc.perform(put("/api/v1/me").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"customerId\":\"999\",\"expectedVersion\":\"0\",\"firstNames\":\"Intruso\",\"lastNames\":\"Pérez\",\"phone\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_JSON"))
                .andExpect(jsonPath("$.title").value("Solicitud inválida"));
        assertEquals("Ana", gateway.profile.firstNames());
    }

    @Test
    void changesOwnEmailOnlyAfterConfirmingTheCurrentPassword() throws Exception {
        gateway.passwordHash = passwordEncoder.encode("Lectura-segura-2026");

        mvc.perform(put("/api/v1/me/email").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"newEmail\":\"Nueva@Example.com\",\"currentPassword\":\"no-es-esta\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("CURRENT_PASSWORD_INVALID"))
                .andExpect(jsonPath("$.title").value("Contraseña incorrecta"));
        assertEquals(0, gateway.changeEmailCalls);
        assertEquals("ana@example.com", gateway.profile.email());
        assertEquals(0, events.stream(com.pliego.modules.customer.application.CustomerEmailChanged.class).count());

        mvc.perform(put("/api/v1/me/email").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"newEmail\":\"Nueva@Example.com\",\"currentPassword\":\"Lectura-segura-2026\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("nueva@example.com"));
        assertEquals(100L, gateway.lastActorUserId);
        assertEquals("nueva@example.com", gateway.profile.email());
        // The integration point for the future mail adapter carries both addresses.
        assertEquals(List.of(new com.pliego.modules.customer.application.CustomerEmailChanged(100L, "ana@example.com", "nueva@example.com")),
                events.stream(com.pliego.modules.customer.application.CustomerEmailChanged.class).toList());
    }

    @Test
    void rejectsATakenOrMalformedEmailWithSpanishProblems() throws Exception {
        gateway.passwordHash = passwordEncoder.encode("Lectura-segura-2026");

        mvc.perform(put("/api/v1/me/email").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"newEmail\":\"tomado@example.com\",\"currentPassword\":\"Lectura-segura-2026\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("P1101"))
                .andExpect(jsonPath("$.title").value("Correo ya registrado"));

        mvc.perform(put("/api/v1/me/email").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"newEmail\":\"sin-arroba\",\"currentPassword\":\"Lectura-segura-2026\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        mvc.perform(put("/api/v1/me/email").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"newEmail\":\"nueva@example.com\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertEquals(1, gateway.changeEmailCalls);
        assertEquals("ana@example.com", gateway.profile.email());
    }

    @Test
    void blockedCustomerReceivesSafeSpanishAuthenticationProblem() throws Exception {
        gateway.failure = exceptionTranslator.translate(new SQLException("internal blocked account detail", "P1003"));

        mvc.perform(get("/api/v1/me").header("Authorization", customerToken("100")))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("P1003"))
                .andExpect(jsonPath("$.title").value("Cuenta bloqueada"))
                .andExpect(jsonPath("$.detail").value("Tu cuenta está bloqueada y no puede realizar esta operación."))
                .andExpect(jsonPath("$.traceId").isNotEmpty());
    }

    @Test
    void listsCreatesAndChangesPrimaryAddressesIdempotently() throws Exception {
        mvc.perform(get("/api/v1/me/addresses").header("Authorization", customerToken("100")))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isArray()).andExpect(jsonPath("$").isEmpty());
        assertEquals(100L, gateway.lastActorUserId);

        String first = mvc.perform(post("/api/v1/me/addresses").header("Idempotency-Key", UUID.randomUUID().toString()).header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADDRESS))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.addressId").value("501"))
                .andReturn().getResponse().getContentAsString();
        assertFalse(first.contains("customerId"));

        String secondRequest = ADDRESS.replace("\"Casa\"", "\"Trabajo\"");
        mvc.perform(post("/api/v1/me/addresses").header("Idempotency-Key", UUID.randomUUID().toString()).header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(secondRequest))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.addressId").value("502"));

        mvc.perform(get("/api/v1/me/addresses").header("Authorization", customerToken("100")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].addressId").value("501"))
                .andExpect(jsonPath("$[0].primary").value(false))
                .andExpect(jsonPath("$[1].primary").value(true));

        mvc.perform(put("/api/v1/me/addresses/501/primary").header("Authorization", customerToken("100")))
                .andExpect(status().isNoContent());
        mvc.perform(put("/api/v1/me/addresses/501/primary").header("Authorization", customerToken("100")))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/me/addresses").header("Authorization", customerToken("100")))
                .andExpect(jsonPath("$[0].primary").value(true))
                .andExpect(jsonPath("$[1].primary").value(false));
    }

    @Test
    void updatesAndDeletesOwnAddressesWithoutDisclosingForeignOwnership() throws Exception {
        mvc.perform(post("/api/v1/me/addresses").header("Idempotency-Key", UUID.randomUUID().toString()).header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADDRESS))
                .andExpect(status().isCreated());
        mvc.perform(put("/api/v1/me/addresses/501").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADDRESS_UPDATE))
                .andExpect(status().isNoContent());
        assertEquals("Trabajo", gateway.addresses.getFirst().alias());
        assertEquals(100L, gateway.lastActorUserId);

        String missing = mvc.perform(put("/api/v1/me/addresses/900").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADDRESS_UPDATE))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("P1103"))
                .andExpect(jsonPath("$.title").value("Dirección no encontrada"))
                .andExpect(jsonPath("$.detail").value("La dirección solicitada no existe o no está disponible para tu cuenta."))
                .andExpect(jsonPath("$.traceId").isNotEmpty()).andReturn().getResponse().getContentAsString();
        assertFalse(missing.contains("pertenece"));
        assertFalse(missing.contains("foreign"));

        mvc.perform(delete("/api/v1/me/addresses/900").header("Authorization", customerToken("100")))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.title").value("Dirección no encontrada"));
        mvc.perform(delete("/api/v1/me/addresses/501").header("Authorization", customerToken("100")))
                .andExpect(status().isNoContent());
        assertTrue(gateway.addresses.isEmpty());
    }

    @Test
    void deletingPrimaryMayLeaveNoPrimaryAndInvalidInputIsSpanish() throws Exception {
        mvc.perform(post("/api/v1/me/addresses").header("Idempotency-Key", UUID.randomUUID().toString()).header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADDRESS))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/v1/me/addresses").header("Idempotency-Key", UUID.randomUUID().toString()).header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(ADDRESS.replace("\"Casa\"", "\"Otra\"")
                                .replace("\"makePrimary\":true", "\"makePrimary\":false")))
                .andExpect(status().isCreated());
        mvc.perform(delete("/api/v1/me/addresses/501").header("Authorization", customerToken("100")))
                .andExpect(status().isNoContent());
        assertTrue(gateway.addresses.stream().noneMatch(CustomerAddress::primary));

        String invalidCountry = ADDRESS.replace("\"EC\"", "\"E\"");
        String invalid = mvc.perform(post("/api/v1/me/addresses").header("Idempotency-Key", UUID.randomUUID().toString()).header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(invalidCountry))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.title").value("Datos inválidos"))
                .andExpect(jsonPath("$.detail").value("Revisa los datos enviados e intenta nuevamente."))
                .andExpect(jsonPath("$.traceId").isNotEmpty()).andReturn().getResponse().getContentAsString();
        assertTrue(invalid.contains("El código de país debe tener dos letras."));

        String invalidPhone = ADDRESS.replace("+59325550134", "phone");
        mvc.perform(post("/api/v1/me/addresses").header("Idempotency-Key", UUID.randomUUID().toString()).header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON).content(invalidPhone))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(result -> assertTrue(result.getResponse().getContentAsString()
                        .contains("Usa solo dígitos, espacios, paréntesis, puntos o guiones; no incluyas letras ni extensiones.")));

        mvc.perform(put("/api/v1/me").header("Authorization", customerToken("100"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":\"0\",\"firstNames\":\" \",\"lastNames\":\"Pérez\",\"phone\":\"123\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(result -> assertTrue(result.getResponse().getContentAsString()
                        .contains("Escribe tus nombres.")));
    }

    @Test
    void unexpectedDatabaseErrorsRemainInternalAndDoNotLeakDatabaseText() throws Exception {
        for (String sqlState : List.of("P9001", "23514")) {
            gateway.failure = exceptionTranslator.translate(new SQLException("private constraint and SQL details", sqlState));
            String body = mvc.perform(get("/api/v1/me/addresses").header("Authorization", customerToken("100")))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.traceId").isNotEmpty())
                    .andReturn().getResponse().getContentAsString();
            assertTrue(body.contains("Ocurrió un error interno."));
            assertFalse(body.contains("private constraint"));
            assertFalse(body.contains("SQL details"));
            gateway.failure = null;
        }
    }

    @Test
    void openApiListsEveryProfileAndAddressEndpoint() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['/api/v1/me'].get").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me'].put").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/addresses'].get").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/addresses'].post").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/addresses/{addressId}'].put").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/addresses/{addressId}'].delete").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/addresses/{addressId}/primary'].put").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/favorites'].get").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/favorites'].get.responses.200.content['application/json'].schema.$ref")
                        .value("#/components/schemas/CustomerFavoritePage"))
                .andExpect(jsonPath("$.paths['/api/v1/me/favorites/status'].get").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/favorites/{editionId}'].put").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me/favorites/{editionId}'].delete").exists());
    }

    @Test
    void customerFavoritesCanBeListedCheckedAddedAndRemoved() throws Exception {
        mvc.perform(put("/api/v1/me/favorites/42").header("Authorization", customerToken("100")))
                .andExpect(status().isNoContent());
        mvc.perform(put("/api/v1/me/favorites/42").header("Authorization", customerToken("100")))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/me/favorites/status").param("editionIds", "42", "43")
                        .header("Authorization", customerToken("100")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].editionId").value("42"))
                .andExpect(jsonPath("$[0].favorite").value(true))
                .andExpect(jsonPath("$[1].editionId").value("43"))
                .andExpect(jsonPath("$[1].favorite").value(false));

        mvc.perform(get("/api/v1/me/favorites").header("Authorization", customerToken("100")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCount").value("1"))
                .andExpect(jsonPath("$.items[0].editionId").value("42"))
                .andExpect(jsonPath("$.items[0].title").value("Edición favorita"))
                .andExpect(jsonPath("$.items[0].available").value(true));

        mvc.perform(delete("/api/v1/me/favorites/42").header("Authorization", customerToken("100")))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/api/v1/me/favorites/42").header("Authorization", customerToken("100")))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/me/favorites/status").param("editionIds", "42")
                        .header("Authorization", customerToken("100")))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].favorite").value(false));
    }

    @Test
    void favoritesRequireAnAuthenticatedCustomerAndBoundStatusBatchSize() throws Exception {
        mvc.perform(get("/api/v1/me/favorites"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
        mvc.perform(get("/api/v1/me/favorites/status").param("editionIds", "1")
                        .header("Authorization", customerToken("100")))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/me/favorites/status")
                        .header("Authorization", customerToken("100")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    private String customerToken(String actorUserId) {
        Instant issuedAt = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        return "Bearer " + tokenIssuer.issue(actorUserId, "CUSTOMER", issuedAt,
                issuedAt.plusSeconds(1800), UUID.randomUUID().toString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestConfigurationForCustomerApi {

        @Bean
        PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override public TransactionStatus getTransaction(TransactionDefinition definition) {
                    return new SimpleTransactionStatus();
                }
                @Override public void commit(TransactionStatus status) { }
                @Override public void rollback(TransactionStatus status) { }
            };
        }

        @Bean
        @Primary
        FakeCustomerGateway customerGateway(DatabaseExceptionTranslator translator) {
            return new FakeCustomerGateway(translator);
        }
    }

    static class FakeCustomerGateway implements CustomerGateway {
        private final DatabaseExceptionTranslator translator;
        private final List<CustomerAddress> addresses = new ArrayList<>();
        private CustomerProfile profile = new CustomerProfile(87, "ana@example.com", "Ana María", "Pérez López",
                "+59325550134", "ACTIVE");
        private long lastActorUserId;
        private long nextAddressId = 501;
        private DatabaseException failure;
        private final List<Favorite> favorites = new ArrayList<>();
        private String passwordHash;
        private int changeEmailCalls;

        FakeCustomerGateway(DatabaseExceptionTranslator translator) {
            this.translator = translator;
        }

        void reset() {
            addresses.clear();
            profile = new CustomerProfile(87, "ana@example.com", "Ana María", "Pérez López", "+59325550134", "ACTIVE");
            lastActorUserId = 0;
            nextAddressId = 501;
            failure = null;
            favorites.clear();
            passwordHash = null;
            changeEmailCalls = 0;
        }

        private void beforeCall(long actorUserId) {
            lastActorUserId = actorUserId;
            if (failure != null) throw failure;
        }

        @Override public CustomerProfile findProfile(long actorUserId) {
            beforeCall(actorUserId);
            return profile;
        }

        @Override public void patchProfile(long actorUserId, long expectedVersion, String field, String value) {
            CustomerProfile current = findProfile(actorUserId);
            updateProfile(actorUserId, expectedVersion,
                    "firstNames".equals(field) ? value : current.firstNames(),
                    "lastNames".equals(field) ? value : current.lastNames(),
                    "phone".equals(field) ? value : current.phone());
        }
        @Override public com.pliego.modules.customer.application.AddressAttempt resolveAddress(long actorUserId, UUID key) {
            return new com.pliego.modules.customer.application.AddressAttempt("PENDING", null);
        }
        @Override public void updateProfile(long actorUserId, long expectedVersion, String firstNames, String lastNames, String phone) {
            beforeCall(actorUserId);
            profile = new CustomerProfile(profile.customerId(), profile.email(), firstNames, lastNames, phone,
                    profile.state());
        }

        @Override public String passwordHash(long actorUserId) {
            beforeCall(actorUserId);
            return passwordHash;
        }

        @Override public String changeEmail(long actorUserId, String newEmail) {
            beforeCall(actorUserId);
            changeEmailCalls++;
            String normalized = newEmail.trim().toLowerCase(java.util.Locale.ROOT);
            if (normalized.equals("tomado@example.com")) {
                throw translator.translate(new SQLException("private unique constraint uq_usuario_email", "P1101"));
            }
            profile = new CustomerProfile(profile.customerId(), normalized, profile.firstNames(), profile.lastNames(),
                    profile.phone(), profile.state());
            return normalized;
        }

        @Override public List<CustomerAddress> listAddresses(long actorUserId) {
            beforeCall(actorUserId);
            return List.copyOf(addresses);
        }

        @Override public long createAddress(long actorUserId, UUID key, AddressData address, boolean makePrimary) {
            beforeCall(actorUserId);
            if (makePrimary) setNoAddressesPrimary();
            long id = nextAddressId++;
            addresses.add(new CustomerAddress(id, address.alias(), address.recipient(), address.line1(), address.line2(),
                    address.city(), address.province(), address.countryCode(), address.postalCode(), address.reference(),
                    address.phone(), makePrimary));
            return id;
        }

        @Override public void updateAddress(long actorUserId, long addressId, AddressData address) {
            beforeCall(actorUserId);
            int index = findOwnAddress(addressId);
            CustomerAddress old = addresses.get(index);
            addresses.set(index, new CustomerAddress(addressId, address.alias(), address.recipient(), address.line1(),
                    address.line2(), address.city(), address.province(), address.countryCode(), address.postalCode(),
                    address.reference(), address.phone(), old.primary()));
        }

        @Override public void deleteAddress(long actorUserId, long addressId) {
            beforeCall(actorUserId);
            addresses.remove(findOwnAddress(addressId));
        }

        @Override public void setPrimaryAddress(long actorUserId, long addressId) {
            beforeCall(actorUserId);
            findOwnAddress(addressId);
            for (int index = 0; index < addresses.size(); index++) {
                CustomerAddress address = addresses.get(index);
                addresses.set(index, new CustomerAddress(address.addressId(), address.alias(), address.recipient(),
                        address.line1(), address.line2(), address.city(), address.province(), address.countryCode(),
                        address.postalCode(), address.reference(), address.phone(), address.addressId() == addressId));
            }
        }

        @Override public Page listFavorites(long actorUserId, int page, int pageSize) {
            beforeCall(actorUserId);
            int fromIndex = Math.min(page * pageSize, favorites.size());
            int toIndex = Math.min(fromIndex + pageSize, favorites.size());
            return new Page(favorites.subList(fromIndex, toIndex), favorites.size());
        }

        @Override public List<Status> favoriteStatus(long actorUserId, List<Long> editionIds) {
            beforeCall(actorUserId);
            return editionIds.stream().distinct().map(id -> new Status(id,
                    favorites.stream().anyMatch(favorite -> favorite.editionId() == id))).toList();
        }

        @Override public void addFavorite(long actorUserId, long editionId) {
            beforeCall(actorUserId);
            if (favorites.stream().noneMatch(favorite -> favorite.editionId() == editionId)) {
                favorites.add(new Favorite(editionId, 12, "Edición favorita", "Autora de prueba", "Editorial",
                        new java.math.BigDecimal("12.50"), null, null, null, "PAPERBACK", "es", true,
                        Instant.parse("2026-09-29T12:00:00Z")));
            }
        }

        @Override public void removeFavorite(long actorUserId, long editionId) {
            beforeCall(actorUserId);
            favorites.removeIf(favorite -> favorite.editionId() == editionId);
        }

        private void setNoAddressesPrimary() {
            for (int index = 0; index < addresses.size(); index++) {
                CustomerAddress address = addresses.get(index);
                addresses.set(index, new CustomerAddress(address.addressId(), address.alias(), address.recipient(),
                        address.line1(), address.line2(), address.city(), address.province(), address.countryCode(),
                        address.postalCode(), address.reference(), address.phone(), false));
            }
        }

        private int findOwnAddress(long addressId) {
            for (int index = 0; index < addresses.size(); index++) {
                if (addresses.get(index).addressId() == addressId) return index;
            }
            throw translator.translate(new SQLException("private foreign address", "P1103"));
        }
    }
}
