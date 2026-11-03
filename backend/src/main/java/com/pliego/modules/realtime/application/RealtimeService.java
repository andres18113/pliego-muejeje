package com.pliego.modules.realtime.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.realtime.gateway.RealtimeGateway;

@Service
public class RealtimeService {
 private final RealtimeGateway gateway;
 public RealtimeService(RealtimeGateway gateway){this.gateway=gateway;}
 @Transactional
 public String connect(String cookie,UUID connection){
  if(cookie==null || !cookie.matches("[A-Za-z0-9_-]{43}"))return "UNAUTHORIZED";
  try{return gateway.connect(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
   .digest(cookie.getBytes(StandardCharsets.US_ASCII))),connection);}
  catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
 }
 @Transactional(readOnly=true)
 public RealtimeGateway.Batch read(UUID connection,Long cursor){return gateway.read(connection,cursor);}
 @Transactional
 public void disconnect(UUID connection){gateway.disconnect(connection);}
 @Transactional
 public void publish(){gateway.publish();}
}
