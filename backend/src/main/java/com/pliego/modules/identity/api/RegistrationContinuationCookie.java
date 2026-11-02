package com.pliego.modules.identity.api;

import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/** Separate, host-only credential with no authorization before proof and exchange. */
@Component
public final class RegistrationContinuationCookie {
    public static final String NAME="pliego_registration";
    private final boolean secure;
    public RegistrationContinuationCookie(@Value("${pliego.auth.cookie-secure:true}") boolean secure){this.secure=secure;}
    public String issue(String secret,Instant expires) {
        return cookie(secret,Duration.ofSeconds(Math.max(0,Duration.between(Instant.now(),expires).getSeconds())));
    }
    public String clear(){return cookie("",Duration.ZERO);}
    private String cookie(String secret,Duration maxAge){
        return ResponseCookie.from(NAME,secret).httpOnly(true).secure(secure).sameSite("Strict")
                .path("/api/v1/auth").maxAge(maxAge).build().toString();
    }
}
