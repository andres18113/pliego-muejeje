package com.pliego.modules.customer.api;

import static com.pliego.foundation.validation.PhoneValidationTestCases.malformedPhones;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import com.pliego.foundation.security.JwtTokenIssuer;
import tools.jackson.databind.ObjectMapper;

@org.springframework.test.context.TestPropertySource(properties = "pliego.mail.enabled=false")
@SpringBootTest(properties = {"spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i3_test", "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test", "spring.flyway.enabled=false", "PLIEGO_ADMIN_EMAIL=admin@example.com", "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef", "pliego.cors.allowed-origins="})
@AutoConfigureMockMvc
@Import(CustomerApiIntegrationTest.TestConfigurationForCustomerApi.class)
class CustomerValidationApiIntegrationTest {
    private static final String ADDRESS = """
            {"alias":"Casa","recipient":"Ana Pérez","line1":"Calle 1","provinceId":"17","cityId":"801","countryCode":"EC"%s}
            """;
    private static final String PHONE_REQUIRED = "Escribe un teléfono de contacto.";

    @Autowired MockMvc mvc;
    @Autowired JwtTokenIssuer issuer;
    @Autowired CustomerApiIntegrationTest.FakeCustomerGateway gateway;
    @Autowired ObjectMapper objectMapper;
    @BeforeEach void reset() { gateway.reset(); }
    private String token() {
        Instant now = Instant.now();
        return "Bearer " + issuer.issue("100", "CUSTOMER", now, now.plusSeconds(1800), UUID.randomUUID().toString());
    }
    private org.springframework.test.web.servlet.ResultActions replace(String first, String last, String phone) throws Exception {
        return mvc.perform(put("/api/v1/me").header("Authorization", token()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"firstNames\":\""+first+"\",\"lastNames\":\""+last+"\",\"phone\":"+objectMapper.writeValueAsString(phone)+",\"expectedVersion\":\"0\"}"));
    }
    private org.springframework.test.web.servlet.ResultActions patchPhone(String phone) throws Exception {
        return mvc.perform(patch("/api/v1/me").header("Authorization", token()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"field\":\"phone\",\"value\":" + objectMapper.writeValueAsString(phone) + ",\"expectedVersion\":\"0\"}"));
    }
    @Test void replacementRejectsNameDigitsAtTheirField() throws Exception {
        replace("Gat1n", "Pérez", null).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("firstNames"))
                .andExpect(jsonPath("$.violations[0].message").value("Tus nombres solo pueden contener letras, espacios, apóstrofes y guiones."));
    }
    @Test void precisePatchRejectsNameDigitsAtValue() throws Exception {
        mvc.perform(patch("/api/v1/me").header("Authorization",token()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"field\":\"firstNames\",\"value\":\"Gat1n\",\"expectedVersion\":\"0\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.violations[0].field").value("value"));
    }
    @Test void formattedPhoneNormalizesWithoutChangingDigits() throws Exception {
        replace("Ana", "Pérez", "+593 (99) 123-4567").andExpect(status().isNoContent());
        assertEquals("+593991234567",gateway.findProfile(100L).phone());
    }
    @Test void ambiguousNationalPhoneAndNationalZeroAfterCallingCodeAreRejected() throws Exception {
        for (String phone : new String[]{"0991234567", "+5930991234567", "+593991234567 ext 5", "()", "..."}) {
            replace("Ana", "Pérez", phone).andExpect(status().isBadRequest()).andExpect(jsonPath("$.violations[0].field").value("phone"));
        }
    }
    @Test void profilePatchAppliesTheSamePhoneRule() throws Exception {
        // A PATCH names the request property that failed: "value" (the contract also used by names).
        patchPhone("0991234567").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].field").value("value"));
    }

    @ParameterizedTest
    @NullAndEmptySource
    void profilePatchClearsThePhoneWhenGivenNullOrEmptyValue(String phone) throws Exception {
        assertEquals("+59325550134", gateway.findProfile(100L).phone());
        patchPhone(phone).andExpect(status().isNoContent());
        assertNull(gateway.findProfile(100L).phone());
    }

    @Test void profilePatchStillRequiresValueAndRejectsAnExtraPhoneProperty() throws Exception {
        var before = gateway.findProfile(100L);
        for (String body : new String[]{"{\"field\":\"phone\",\"expectedVersion\":\"0\"}",
                "{\"field\":\"phone\",\"value\":null,\"expectedVersion\":\"0\",\"phone\":\"+593991234567\"}"}) {
            mvc.perform(patch("/api/v1/me").header("Authorization", token()).contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MALFORMED_JSON"));
        }
        assertEquals(before, gateway.findProfile(100L));
    }

    static Stream<Arguments> invalidAddressPhones() {
        return Stream.concat(malformedPhones().map(arguments -> {
                    String phone = (String) arguments.get()[0];
                    String message = phone.isBlank() ? PHONE_REQUIRED : (String) arguments.get()[1];
                    return Arguments.of(true, phone, message);
                }), Stream.of(Arguments.of(true, "", PHONE_REQUIRED),
                        Arguments.of(true, null, PHONE_REQUIRED),
                        Arguments.of(false, null, PHONE_REQUIRED)));
    }

    @ParameterizedTest
    @MethodSource("invalidAddressPhones")
    void addressCommandsRejectInvalidPhoneWithoutChangingAnyAddress(boolean includePhone, String phone, String message) throws Exception {
        String phoneProperty = includePhone ? ",\"phone\":" + objectMapper.writeValueAsString(phone) : "";
        String token = token();
        mvc.perform(post("/api/v1/me/addresses").header("Authorization", token)
                        .header("Idempotency-Key", UUID.randomUUID().toString()).contentType(MediaType.APPLICATION_JSON)
                        .content(ADDRESS.formatted(",\"phone\":\"+593991234567\",\"makePrimary\":true")))
                .andExpect(status().isCreated());
        var before = gateway.listAddresses(100L);

        mvc.perform(put("/api/v1/me/addresses/{addressId}", before.getFirst().addressId())
                        .header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
                        .content(ADDRESS.formatted(phoneProperty).replace("Casa", "Trabajo").replace("Calle 1", "Calle 2")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].field").value("phone"))
                .andExpect(jsonPath("$.violations[0].message").value(message));
        assertEquals(before, gateway.listAddresses(100L));

        mvc.perform(post("/api/v1/me/addresses").header("Authorization", token)
                        .header("Idempotency-Key", UUID.randomUUID().toString()).contentType(MediaType.APPLICATION_JSON)
                        .content(ADDRESS.formatted(phoneProperty + ",\"makePrimary\":true")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].field").value("phone"))
                .andExpect(jsonPath("$.violations[0].message").value(message));
        assertEquals(before, gateway.listAddresses(100L));
    }

    @ParameterizedTest
    @MethodSource("com.pliego.foundation.validation.PhoneValidationTestCases#malformedPhones")
    void profileReplacementRejectsInvalidPhoneWithoutUpdatingTheProfile(String phone, String message) throws Exception {
        var before = gateway.findProfile(100L);
        replace("María", "Pérez", phone).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].field").value("phone"))
                .andExpect(jsonPath("$.violations[0].message").value(message));
        assertEquals(before, gateway.findProfile(100L));
    }

    @ParameterizedTest
    @MethodSource("com.pliego.foundation.validation.PhoneValidationTestCases#malformedPhones")
    void profilePatchRejectsInvalidPhoneWithoutUpdatingTheProfile(String phone, String message) throws Exception {
        var before = gateway.findProfile(100L);
        patchPhone(phone).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].field").value("value"))
                .andExpect(jsonPath("$.violations[0].message").value(message));
        assertEquals(before, gateway.findProfile(100L));
    }
    @Test void namesCountUnicodeCodePointsAndNormalizeAccents() throws Exception {
        replace("𐐀".repeat(120), "O’Connor-Pérez", null).andExpect(status().isNoContent());
        replace("A\u0301na", "李", null).andExpect(status().isNoContent());
        assertEquals("Ána",gateway.findProfile(100L).firstNames());
    }
    @Test void fullValidProfileNameFitsTheAddressRecipient() throws Exception {
        String recipient="A".repeat(120)+" "+"B".repeat(120);
        mvc.perform(post("/api/v1/me/addresses").header("Authorization",token()).header("Idempotency-Key",UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON).content("{\"alias\":\"Casa\",\"recipient\":\""+recipient+"\",\"line1\":\"Calle 1\",\"provinceId\":\"17\",\"cityId\":\"801\",\"countryCode\":\"EC\",\"phone\":\"+593991234567\",\"makePrimary\":true}"))
                .andExpect(status().isCreated());
    }
}
