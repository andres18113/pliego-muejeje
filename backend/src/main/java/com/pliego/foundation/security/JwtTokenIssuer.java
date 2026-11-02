package com.pliego.foundation.security;

import java.time.Instant;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
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
        if (!Duration.between(issuedAt, expiresAt).equals(JwtAccessTokenClaims.LIFETIME)) {
            throw new IllegalArgumentException("Access token lifetime must match the JWT contract");
        }
        Instant issuedSecond = issuedAt.truncatedTo(ChronoUnit.SECONDS);
        Map<String, Object> claims = Map.of(
                "iss", JwtAccessTokenClaims.ISSUER,
                "aud", JwtAccessTokenClaims.AUDIENCE,
                "sub", userId,
                "role", role,
                "iat", issuedSecond.getEpochSecond(),
                "exp", issuedSecond.plus(JwtAccessTokenClaims.LIFETIME).getEpochSecond(),
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
