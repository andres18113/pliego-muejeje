package com.pliego.modules.identity.api;

import com.pliego.modules.identity.application.AuthService.LoginResult;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name="RegistrationSessionResponse")
public record RegistrationSessionResponse(String accessToken,String tokenType,int expiresInSeconds,
        LoginResponse.AuthenticatedUser user,@Schema(nullable=true) String returnTo) {
    public static RegistrationSessionResponse from(LoginResult session,String returnTo) {
        return new RegistrationSessionResponse(session.accessToken(),"Bearer",Math.toIntExact(session.expiresInSeconds()),
                new LoginResponse.AuthenticatedUser(Long.toString(session.userId()),session.email(),session.role()),returnTo);
    }
    @Override public String toString(){return "RegistrationSessionResponse[REDACTED]";}
}
