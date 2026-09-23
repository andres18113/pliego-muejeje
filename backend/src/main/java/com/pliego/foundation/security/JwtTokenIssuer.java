package com.pliego.foundation.security;

import java.time.Instant;
import java.util.Map;

import javax.crypto.SecretKey;

import org.springframework.stereotype.Component;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSObject;
import com.nimbusds.jose.Payload;
import com.nimbusds.jose.crypto.MACSigner;

/** Issues the approved compact token claims using the same Nimbus JOSE stack as Spring's decoder. */
@Component
public final class JwtTokenIssuer {

    private final SecretKey secretKey;

    public JwtTokenIssuer(SecretKey pliegoJwtSecretKey) {
        this.secretKey = pliegoJwtSecretKey;
    }

    public String issue(String userId, String role, Instant issuedAt, Instant expiresAt, String tokenId) {
        Map<String, Object> claims = Map.of(
                "iss", "pliego",
                "aud", "pliego-api",
                "sub", userId,
                "role", role,
                "iat", issuedAt.getEpochSecond(),
                "exp", expiresAt.getEpochSecond(),
                "jti", tokenId);
        JWSObject jws = new JWSObject(
                new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).build(),
                new Payload(claims));
        try {
            jws.sign(new MACSigner(secretKey));
        } catch (JOSEException exception) {
            throw new IllegalStateException("Unable to issue access token", exception);
        }
        return jws.serialize();
    }
}
