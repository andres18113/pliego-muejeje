package com.pliego.modules.identity.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.SQLException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.Map;
import java.util.Arrays;

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
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.pliego.modules.identity.gateway.IdentityGateway;
import com.pliego.modules.identity.gateway.RegistrationResult;
import com.pliego.modules.identity.gateway.UserAuthData;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSObject;
import com.nimbusds.jose.Payload;
import com.nimbusds.jose.crypto.MACSigner;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/pliego_i2_test",
        "spring.datasource.username=pliego_test",
        "spring.datasource.password=pliego_test",
        "spring.flyway.enabled=false",
        "PLIEGO_ADMIN_EMAIL=admin@example.com",
        "PLIEGO_ADMIN_PASSWORD_HASH=unused",
        "PLIEGO_JWT_SECRET=0123456789abcdef0123456789abcdef",
        "pliego.cors.allowed-origins="
})
@AutoConfigureMockMvc
@Import(AuthApiIntegrationTest.NoDatabaseTransactionConfiguration.class)
class AuthApiIntegrationTest {

    private static final String REGISTER_JSON = """
            {"email":"ana@example.com","password":"password-segura","firstNames":"Ana María","lastNames":"Pérez López","phone":"+59325550134"}
            """;
    private static final String LOGIN_JSON = """
            {"email":"ana@example.com","password":"password-segura"}
            """;

    @Autowired
    MockMvc mvc;

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    JwtDecoder jwtDecoder;

    @Autowired
    JwtEncoder jwtEncoder;

    @Autowired
    DatabaseExceptionTranslator exceptionTranslator;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    FakeIdentityGateway identityGateway;

    @TestConfiguration(proxyBeanMethods = false)
    static class NoDatabaseTransactionConfiguration {

        @Bean
        PlatformTransactionManager transactionManager() {
            return new PlatformTransactionManager() {
                @Override
                public TransactionStatus getTransaction(TransactionDefinition definition) {
                    return new SimpleTransactionStatus();
                }

                @Override
                public void commit(TransactionStatus status) {
                }

                @Override
                public void rollback(TransactionStatus status) {
                }
            };
        }

        @Bean
        @Primary
        FakeIdentityGateway identityGateway() {
            return new FakeIdentityGateway();
        }

        @Bean
        org.springframework.security.oauth2.jwt.JwtEncoder jwtEncoder(javax.crypto.SecretKey key) {
            return new org.springframework.security.oauth2.jwt.NimbusJwtEncoder(new ImmutableSecret<>(key));
        }
    }

    @BeforeEach
    void clearGatewayInteractions() {
        identityGateway.reset();
    }

    @Test
    void registerHashesPasswordBeforeCallingGatewayAndReturnsNoCredentialMaterial() throws Exception {
        identityGateway.registrationResult = new RegistrationResult(100, 87, "ACTIVE");

        var response = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(REGISTER_JSON))
                .andExpect(status().isCreated())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.userId").value("100"))
                .andExpect(jsonPath("$.customerId").value("87"))
                .andExpect(jsonPath("$.state").value("ACTIVE"))
                .andReturn();

        org.junit.jupiter.api.Assertions.assertEquals("ana@example.com", identityGateway.registeredEmail);
        org.junit.jupiter.api.Assertions.assertEquals("Ana María", identityGateway.registeredFirstNames);
        org.junit.jupiter.api.Assertions.assertEquals("Pérez López", identityGateway.registeredLastNames);
        org.junit.jupiter.api.Assertions.assertEquals("+59325550134", identityGateway.registeredPhone);
        org.junit.jupiter.api.Assertions.assertTrue(identityGateway.registeredPasswordHash.startsWith("$2a$12$")
                || identityGateway.registeredPasswordHash.startsWith("$2b$12$"));
        org.junit.jupiter.api.Assertions.assertTrue(passwordEncoder.matches("password-segura",
                identityGateway.registeredPasswordHash));
        org.junit.jupiter.api.Assertions.assertFalse(response.getResponse().getContentAsString()
                .contains(identityGateway.registeredPasswordHash));
        org.junit.jupiter.api.Assertions.assertFalse(response.getResponse().getContentAsString().contains("password"));
    }

    @Test
    void duplicateEmailMapsToConflictWithoutDatabaseDetails() throws Exception {
        identityGateway.registrationFailure = exceptionTranslator
                .translate(new SQLException("private uq_usuario_email detail", "P1101"));

        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON).content(REGISTER_JSON))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("P1101"))
                .andExpect(jsonPath("$.type").value("urn:pliego:problem:P1101"))
                .andExpect(jsonPath("$.title").value("Correo ya registrado"))
                .andExpect(jsonPath("$.traceId").isNotEmpty())
                .andExpect(jsonPath("$.detail").value("Ya existe una cuenta con ese correo electrónico."))
                .andExpect(result -> org.junit.jupiter.api.Assertions.assertFalse(
                        result.getResponse().getContentAsString().contains("uq_usuario_email")));
    }

    @Test
    void successfulLoginReturnsAndDecodesContractJwt() throws Exception {
        identityGateway.authData.put("ana@example.com", activeUser("CUSTOMER"));

        var response = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(LOGIN_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresInSeconds").value(1800))
                .andExpect(jsonPath("$.user.userId").value("100"))
                .andExpect(jsonPath("$.user.email").value("ana@example.com"))
                .andExpect(jsonPath("$.user.role").value("CUSTOMER"))
                .andReturn();

        LoginResponse login = objectMapper.readValue(response.getResponse().getContentAsString(), LoginResponse.class);
        Jwt jwt = jwtDecoder.decode(login.accessToken());
        org.junit.jupiter.api.Assertions.assertEquals("pliego", jwt.getClaimAsString("iss"));
        org.junit.jupiter.api.Assertions.assertEquals(List.of("pliego-api"), jwt.getAudience());
        String jwtPayload = new String(java.util.Base64.getUrlDecoder()
                .decode(login.accessToken().split("\\.")[1]), StandardCharsets.UTF_8);
        org.junit.jupiter.api.Assertions.assertTrue(jwtPayload.contains("\"aud\":\"pliego-api\""));
        org.junit.jupiter.api.Assertions.assertEquals("100", jwt.getSubject());
        org.junit.jupiter.api.Assertions.assertEquals("CUSTOMER", jwt.getClaimAsString("role"));
        org.junit.jupiter.api.Assertions.assertEquals(1800, jwt.getExpiresAt().getEpochSecond()
                - jwt.getIssuedAt().getEpochSecond());
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> UUID.fromString(jwt.getId()));

        mvc.perform(get("/api/v1/admin/role-check").header("Authorization", "Bearer " + login.accessToken()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }

    @Test
    void badPasswordUnknownAndBlockedUserHaveIdenticalUnauthorizedProblems() throws Exception {
        String hash = passwordEncoder.encode("different-password");
        identityGateway.authData.put("wrong@example.com",
                new UserAuthData(101, "wrong@example.com", hash, "CUSTOMER", "ACTIVE"));
        identityGateway.authData.put("blocked@example.com",
                new UserAuthData(102, "blocked@example.com", passwordEncoder.encode("password-segura"),
                        "CUSTOMER", "BLOCKED"));

        String unknown = loginProblem("unknown@example.com", "password-segura");
        String wrong = loginProblem("wrong@example.com", "password-segura");
        String blocked = loginProblem("blocked@example.com", "password-segura");
        JsonNode expected = withoutTraceId(objectMapper.readTree(unknown));

        org.junit.jupiter.api.Assertions.assertEquals(expected, withoutTraceId(objectMapper.readTree(wrong)));
        org.junit.jupiter.api.Assertions.assertEquals(expected, withoutTraceId(objectMapper.readTree(blocked)));
        org.junit.jupiter.api.Assertions.assertEquals("AUTH_INVALID_CREDENTIALS", expected.get("code").asString());
    }

    @Test
    void missingInvalidAndExpiredTokensReturnProblemDetail401() throws Exception {
        mvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"))
                .andExpect(jsonPath("$.title").value("Autenticación requerida"))
                .andExpect(result -> org.junit.jupiter.api.Assertions.assertEquals("Bearer",
                        result.getResponse().getHeader("WWW-Authenticate")));

        mvc.perform(get("/api/v1/me").header("Authorization", "Bearer not-a-jwt"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_INVALID_TOKEN"));

        Instant issuedAt = Instant.now().minusSeconds(1801);
        String expired = encodeToken("100", "CUSTOMER", issuedAt, issuedAt.plusSeconds(1800));
        mvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + expired))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_INVALID_TOKEN"));
    }

    @Test
    void decoderRejectsWrongIssuerAudienceSignatureAndAlgorithm() throws Exception {
        Instant issuedAt = Instant.now().minusSeconds(1);
        Instant expiresAt = issuedAt.plusSeconds(1800);
        assertInvalidToken(encodeToken("100", "CUSTOMER", issuedAt, expiresAt, "other-issuer", List.of("pliego-api")));
        assertInvalidToken(encodeToken("100", "CUSTOMER", issuedAt, expiresAt, "pliego", List.of("other-api")));

        String valid = encodeToken("100", "CUSTOMER", issuedAt, expiresAt);
        String[] sections = valid.split("\\.");
        char firstSignatureCharacter = sections[2].charAt(0);
        sections[2] = (firstSignatureCharacter == 'A' ? 'B' : 'A') + sections[2].substring(1);
        assertInvalidToken(String.join(".", sections));
        assertInvalidToken(signHs512Token(issuedAt, expiresAt));
    }

    @Test
    void administratorRoleIsNotAuthorizedForCustomerRoutes() throws Exception {
        Instant issuedAt = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        String token = encodeToken("7", "ADMIN", issuedAt, issuedAt.plusSeconds(1800));

        mvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"))
                .andExpect(jsonPath("$.title").value("Acceso denegado"));
    }

    @Test
    void requestValidationMalformedJsonAndUnknownFieldsUseProblemDetail400() throws Exception {
        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"bad\",\"password\":\"short\",\"firstNames\":\"\",\"lastNames\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.title").value("Datos inválidos"))
                .andExpect(jsonPath("$.detail").value("Revisa los datos enviados e intenta nuevamente."))
                .andExpect(jsonPath("$.violations").isArray());

        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON).content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_JSON"));

        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ana@example.com\",\"password\":\"password-segura\",\"unexpected\":true}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_JSON"));
    }

    @Test
    void p9001AndRawCheckViolationBecomeSafeInternalProblems() throws Exception {
        identityGateway.registrationFailure = exceptionTranslator
                .translate(new SQLException("secret P9001 postgres message", "P9001"));
        String p9001 = mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(REGISTER_JSON))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("P9001"))
                .andExpect(jsonPath("$.type").value("urn:pliego:problem:P9001"))
                .andExpect(jsonPath("$.title").value("No se pudo completar la operación"))
                .andReturn().getResponse().getContentAsString();
        assertNoDatabaseInformation(p9001);

        identityGateway.reset();
        identityGateway.registrationFailure = exceptionTranslator
                .translate(new SQLException("secret check constraint name", "23514"));
        String checkViolation = mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(REGISTER_JSON))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("DATABASE_CONTRACT_VIOLATION"))
                .andReturn().getResponse().getContentAsString();
        assertNoDatabaseInformation(checkViolation);

        identityGateway.reset();
        identityGateway.registrationFailure = exceptionTranslator
                .translate(new SQLException("secret unexpected unique violation", "23505"));
        String unexpected = mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(REGISTER_JSON))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_SERVER_ERROR"))
                .andReturn().getResponse().getContentAsString();
        assertNoDatabaseInformation(unexpected);
    }

    @Test
    void openApiDocumentsOnlyThisSliceAndItsBearerScheme() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openapi").value("3.1.2"))
                .andExpect(jsonPath("$.paths['/api/v1/auth/register'].post").exists())
                .andExpect(jsonPath("$.paths['/api/v1/auth/login'].post").exists())
                .andExpect(jsonPath("$.components.securitySchemes.bearerJwt.scheme").value("bearer"));
    }

    private String loginProblem(String email, String password) throws Exception {
        String json = objectMapper.writeValueAsString(new LoginRequest(email, password));
        return mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_INVALID_CREDENTIALS"))
                .andExpect(jsonPath("$.title").value("Credenciales inválidas"))
                .andExpect(jsonPath("$.detail").value("El correo o la contraseña son incorrectos."))
                .andReturn().getResponse().getContentAsString();
    }

    private UserAuthData activeUser(String role) {
        return new UserAuthData(100, "ana@example.com", passwordEncoder.encode("password-segura"), role, "ACTIVE");
    }

    private String encodeToken(String userId, String role, Instant issuedAt, Instant expiresAt) {
        return encodeToken(userId, role, issuedAt, expiresAt, "pliego", List.of("pliego-api"));
    }

    private String encodeToken(String userId, String role, Instant issuedAt, Instant expiresAt, String issuer,
            List<String> audience) {
        JwtClaimsSet claims = JwtClaimsSet.builder().issuer(issuer).audience(audience)
                .subject(userId).claim("role", role).issuedAt(issuedAt).expiresAt(expiresAt)
                .id(UUID.randomUUID().toString()).build();
        return jwtEncoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();
    }

    private String signHs512Token(Instant issuedAt, Instant expiresAt) throws Exception {
        String payload = objectMapper.writeValueAsString(Map.of(
                "iss", "pliego", "aud", List.of("pliego-api"), "sub", "100", "role", "CUSTOMER",
                "iat", issuedAt.getEpochSecond(), "exp", expiresAt.getEpochSecond(), "jti", UUID.randomUUID().toString()));
        byte[] signingKey = new byte[64];
        Arrays.fill(signingKey, (byte) 'x');
        JWSObject jws = new JWSObject(new JWSHeader.Builder(JWSAlgorithm.HS512)
                .type(JOSEObjectType.JWT).build(), new Payload(payload));
        jws.sign(new MACSigner(signingKey));
        return jws.serialize();
    }

    private void assertInvalidToken(String token) {
        org.junit.jupiter.api.Assertions.assertThrows(JwtException.class, () -> jwtDecoder.decode(token));
    }

    private JsonNode withoutTraceId(JsonNode problem) {
        JsonNode copy = problem.deepCopy();
        ((tools.jackson.databind.node.ObjectNode) copy).remove("traceId");
        return copy;
    }

    private void assertNoDatabaseInformation(String body) {
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("secret"));
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("constraint"));
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("passwordHash"));
        org.junit.jupiter.api.Assertions.assertTrue(body.contains("Ocurrió un error interno."));
    }

    static final class FakeIdentityGateway implements IdentityGateway {

        private final java.util.Map<String, UserAuthData> authData = new java.util.HashMap<>();
        private RegistrationResult registrationResult = new RegistrationResult(100, 87, "ACTIVE");
        private RuntimeException registrationFailure;
        private String registeredEmail;
        private String registeredPasswordHash;
        private String registeredFirstNames;
        private String registeredLastNames;
        private String registeredPhone;

        @Override
        public RegistrationResult register(String email, String passwordHash, String firstNames, String lastNames,
                String phone) {
            registeredEmail = email;
            registeredPasswordHash = passwordHash;
            registeredFirstNames = firstNames;
            registeredLastNames = lastNames;
            registeredPhone = phone;
            if (registrationFailure != null) {
                throw registrationFailure;
            }
            return registrationResult;
        }

        @Override
        public UserAuthData findAuthData(String email) {
            return authData.get(email);
        }

        void reset() {
            authData.clear();
            registrationResult = new RegistrationResult(100, 87, "ACTIVE");
            registrationFailure = null;
            registeredEmail = null;
            registeredPasswordHash = null;
            registeredFirstNames = null;
            registeredLastNames = null;
            registeredPhone = null;
        }

        @Override
        public String toString() {
            return "FakeIdentityGateway[registeredPasswordHash=[redacted]]";
        }
    }
}
