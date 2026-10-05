package com.pliego.modules.identity.application;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.identity.gateway.IdentityGateway;

@Service
public class EmailActionService {
 private final IdentityGateway gateway;
 private final EmailActionTokens tokens;
 private final PasswordEncoder passwords;
 public EmailActionService(IdentityGateway gateway,EmailActionTokens tokens,PasswordEncoder passwords) {
  this.gateway=gateway; this.tokens=tokens; this.passwords=passwords;
 }
 @Transactional
 public void request(String email,String purpose,String remoteAddress) {
  var credential=tokens.issue(purpose);
  gateway.requestEmailAction(email,purpose,credential.hash(),credential.nonce(),EmailActionTokens.hash(remoteAddress));
 }
 @Transactional
 public void verifyChangedEmail(long userId) {
  var credential=tokens.issue("VERIFY_EMAIL");
  gateway.enqueueEmailVerification(userId,credential.hash(),credential.nonce());
 }
 @Transactional
 public boolean verify(String token) {
  return gateway.consumeEmailAction("VERIFY_EMAIL",EmailActionTokens.hash(token),null);
 }
 @Transactional
 public boolean reset(String token,String password) {
  // BCrypt remains the application's existing password-hashing boundary.
  return gateway.consumeEmailAction("RESET_PASSWORD",EmailActionTokens.hash(token),passwords.encode(password));
 }
}
