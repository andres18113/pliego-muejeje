package com.pliego.modules.realtime.gateway;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;

@Repository
public class JdbcRealtimeGateway extends JdbcGatewaySupport implements RealtimeGateway {
 private final JdbcTemplate jdbc;
 private final ObjectMapper mapper;
 public JdbcRealtimeGateway(DatabaseExceptionTranslator errors,JdbcTemplate jdbc,ObjectMapper mapper){
  super(errors);this.jdbc=jdbc;this.mapper=mapper;
 }
 public String connect(String hash,UUID connection){
  return withDatabaseErrorTranslation(()->mapper.readTree(jdbc.queryForObject(
   "SELECT pliego.fn_realtime_connect(?,?)::TEXT",String.class,hash,connection)).path("state").asText());
 }
 private record Projection(String state,String cursor,boolean resync,java.util.List<Event> events){}
 public Batch read(UUID connection,Long cursor){
  return withDatabaseErrorTranslation(()->{
   var p=mapper.readValue(jdbc.queryForObject("SELECT pliego.fn_realtime_read(?,?)::TEXT",String.class,connection,cursor),Projection.class);
   return new Batch("OPEN".equals(p.state()),p.cursor(),p.resync(),p.events()==null?java.util.List.of():p.events());
  });
 }
 public void disconnect(UUID connection){withDatabaseErrorTranslation(()->jdbc.queryForObject(
  "SELECT pliego.fn_realtime_disconnect(?)",Object.class,connection));}
 public void publish(){withDatabaseErrorTranslation(()->jdbc.queryForObject(
  "SELECT pliego.fn_realtime_publish(1000)",Integer.class));}
}
