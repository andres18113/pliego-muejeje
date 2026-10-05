package com.pliego.modules.identity.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** A stored nonce cannot reconstruct an action credential without the external HMAC key. */
@Component
public final class EmailActionTokens {
 private final byte[] secret;
 private final SecureRandom random=new SecureRandom();
 public EmailActionTokens(@Value("${pliego.mail.token-secret}") String secret) {
  this.secret=secret.getBytes(StandardCharsets.UTF_8);
  if(this.secret.length<32) throw new IllegalArgumentException("El secreto de tokens de correo requiere al menos 32 bytes.");
 }
 public Credential issue(String purpose) {
  byte[] bytes=new byte[32]; random.nextBytes(bytes);
  String nonce=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  return new Credential(nonce,hash(derive(purpose,nonce)));
 }
 public String derive(String purpose,String nonce) {
  if(!("VERIFY_EMAIL".equals(purpose)||"RESET_PASSWORD".equals(purpose)) || nonce==null || !nonce.matches("[A-Za-z0-9_-]{43}"))
   throw new IllegalArgumentException("Acción de correo inválida.");
  try {
   Mac mac=Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(secret,"HmacSHA256"));
   return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(("PLIEGO:EMAIL_ACTION:v1:"+purpose+":"+nonce).getBytes(StandardCharsets.UTF_8)));
  } catch(java.security.GeneralSecurityException e) { throw new IllegalStateException("No se pudo generar la credencial de correo."); }
 }
 public static String hash(String value) {
  try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
  catch(java.security.NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 no disponible."); }
 }
 public record Credential(String nonce,String hash) {
  @Override public String toString() { return "EmailActionCredential[REDACTED]"; }
 }
}
