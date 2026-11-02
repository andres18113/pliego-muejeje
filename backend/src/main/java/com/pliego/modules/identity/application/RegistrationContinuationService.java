package com.pliego.modules.identity.application;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.foundation.security.JwtTokenIssuer;
import com.pliego.modules.identity.gateway.RegistrationContinuationGateway;
import com.pliego.modules.identity.gateway.RegistrationContinuationGateway.Outcome;
import com.pliego.modules.identity.gateway.RegistrationResult;
import com.pliego.modules.identity.application.AuthService.LoginResult;

@Service
public class RegistrationContinuationService {
    private static final Pattern SECRET=Pattern.compile("[A-Za-z0-9_-]{43}");
    private final AuthService auth;
    private final AuthSessionCredentialService credentials;
    private final RegistrationContinuationGateway gateway;
    private final JwtTokenIssuer issuer;
    public RegistrationContinuationService(AuthService auth,AuthSessionCredentialService credentials,
            RegistrationContinuationGateway gateway,JwtTokenIssuer issuer) {
        this.auth=auth; this.credentials=credentials; this.gateway=gateway; this.issuer=issuer;
    }
    @Transactional
    public Registered register(String email,String password,String firstNames,String lastNames,String phone,String returnTo) {
        RegistrationResult result=auth.register(email,password,firstNames,lastNames,phone,returnTo);
        String secret=credentials.newSessionToken();
        Instant expires=gateway.issue(result.userId(),EmailActionTokens.hash(secret),AuthReturnPaths.safeOrNull(returnTo));
        return new Registered(result,secret,expires);
    }
    @Transactional
    public Result exchange(String secret,String remoteAddress) {
        if(!valid(secret))return null;
        String refresh=credentials.newSessionToken();
        return result(gateway.exchange(EmailActionTokens.hash(secret),EmailActionTokens.hash(refresh),
                Instant.now().plus(30,ChronoUnit.DAYS),EmailActionTokens.hash(remoteAddress)),refresh);
    }
    @Transactional
    public Result verify(String token,String secret,String remoteAddress) {
        String refresh=credentials.newSessionToken();
        return result(gateway.verify(EmailActionTokens.hash(token),valid(secret)?EmailActionTokens.hash(secret):null,
                EmailActionTokens.hash(refresh),Instant.now().plus(30,ChronoUnit.DAYS),EmailActionTokens.hash(remoteAddress)),refresh);
    }
    @Transactional
    public LoginResult login(String email,String password) {
        LoginResult result=auth.login(email,password);
        gateway.invalidate(result.userId(),null);
        return result;
    }
    @Transactional
    public void logout(String refresh,String secret) {
        // Invalidate continuation before session mutation to preserve user -> continuation -> session lock order.
        if(valid(secret))gateway.invalidate(null,EmailActionTokens.hash(secret));
        auth.logout(refresh);
    }
    private Result result(Outcome outcome,String refresh) {
        if(outcome==null)return null;
        if(!"AUTHENTICATED".equals(outcome.state()))return new Result(outcome.state(),null,null,outcome.retryAfterSeconds());
        Instant issued=Instant.now().truncatedTo(ChronoUnit.SECONDS);
        String access=issuer.issue(Long.toString(outcome.userId()),outcome.role(),issued,issued.plusSeconds(1800),UUID.randomUUID().toString());
        return new Result(outcome.state(),new LoginResult(access,1800,outcome.userId(),outcome.email(),outcome.role(),refresh,outcome.expiresAt()),
                AuthReturnPaths.safeOrNull(outcome.returnTo()),null);
    }
    private static boolean valid(String secret) {return secret!=null&&SECRET.matcher(secret).matches();}
    public record Registered(RegistrationResult registration,String secret,Instant expiresAt) {
        @Override public String toString(){return "Registered[REDACTED]";}
    }
    public record Result(String state,LoginResult session,String returnTo,Integer retryAfterSeconds) {
        @Override public String toString(){return "RegistrationSessionResult[state="+state+"]";}
    }
}
