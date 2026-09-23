package com.pliego.modules.identity.gateway;

public interface IdentityGateway {

    RegistrationResult register(String email, String passwordHash, String firstNames, String lastNames, String phone);

    UserAuthData findAuthData(String email);
}
