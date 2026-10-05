package com.pliego.modules.notifications.application;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("pliego.mail")
public record MailProperties(boolean enabled,URI endpoint,String token,String fromAddress,String fromName,
 URI publicUrl,boolean allowLocalHttp,Duration connectTimeout,Duration requestTimeout,int batchSize) {
 public MailProperties {
  if(enabled) {
   checkUrl(endpoint,allowLocalHttp); checkUrl(publicUrl,allowLocalHttp);
   if(token==null||token.isBlank()||unsafe(token)||fromAddress==null||!fromAddress.matches("[^\\s<>@]+@[^\\s<>@]+")
    ||unsafe(fromAddress)||fromName==null||fromName.isBlank()||unsafe(fromName))
    throw new IllegalArgumentException("Configura token y remitente de correo válidos.");
   if(connectTimeout==null||connectTimeout.isNegative()||connectTimeout.isZero()||connectTimeout.compareTo(Duration.ofSeconds(10))>0
    ||requestTimeout==null||requestTimeout.isNegative()||requestTimeout.isZero()||requestTimeout.compareTo(Duration.ofSeconds(20))>0
    ||batchSize<1||batchSize>10) throw new IllegalArgumentException("Timeouts o lote de correo fuera de rango.");
  }
 }
 private static void checkUrl(URI uri,boolean allowLocal) {
  if(uri==null||uri.getHost()==null||uri.getUserInfo()!=null||uri.getFragment()!=null||uri.getQuery()!=null
   ||!("https".equals(uri.getScheme())||(allowLocal&&"http".equals(uri.getScheme())
     &&("127.0.0.1".equals(uri.getHost())||"localhost".equals(uri.getHost())||"[::1]".equals(uri.getHost())))))
   throw new IllegalArgumentException("Las URLs de correo requieren HTTPS; HTTP solo se permite en loopback explícito.");
 }
 public static boolean unsafe(String value) { return value.indexOf('\r')>=0||value.indexOf('\n')>=0; }
 @Override public String toString() { return "MailProperties[enabled="+enabled+", credentials=REDACTED]"; }
}
