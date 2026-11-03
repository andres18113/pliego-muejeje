package com.pliego.modules.realtime.gateway;

import java.util.UUID;
import java.sql.Types;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCallback;
import org.springframework.dao.IncorrectResultSizeDataAccessException;
import org.springframework.jdbc.IncorrectResultSetColumnCountException;
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
  return withDatabaseErrorTranslation(()->{
   return mapper.readTree(connectionQuery(
    "SELECT pliego.fn_realtime_connect(?,?)::TEXT",hash,connection)).path("state").asText();
  });
 }
 private record Projection(String state,String cursor,boolean resync,java.util.List<Event> events){}
 public Batch read(UUID connection,Long cursor){
  return withDatabaseErrorTranslation(()->{
   var p=mapper.readValue(connectionQuery("SELECT pliego.fn_realtime_read(?,?)::TEXT",connection,cursor),Projection.class);
   return new Batch("OPEN".equals(p.state()),p.cursor(),p.resync(),p.events()==null?java.util.List.of():p.events());
  });
 }
 public void disconnect(UUID connection){withDatabaseErrorTranslation(()->{
  connectionQuery("SELECT pliego.fn_realtime_disconnect(?)",connection);
 });}
 private String connectionQuery(String routine,Object...arguments){
  // Separate server statements arm both limits BEFORE the routine. Batch the
  // commands in one JDBC execution; no extra configuration call per poll.
  String sql="SET LOCAL lock_timeout = '100ms'; SET LOCAL statement_timeout = '1s'; "+routine;
  return jdbc.execute(sql,(PreparedStatementCallback<String>)statement->{
   for(int index=0;index<arguments.length;index++){
    Object value=arguments[index];
    if(value==null)statement.setNull(index+1,Types.BIGINT);
    else if(value instanceof String text)statement.setString(index+1,text);
    else if(value instanceof Long number)statement.setLong(index+1,number);
    else if(value instanceof UUID)statement.setObject(index+1,value);
    else throw new IllegalArgumentException("Tipo de parámetro de tiempo real no compatible.");
   }
   boolean result=statement.execute();
   while(!result && statement.getUpdateCount()!=-1)result=statement.getMoreResults();
   if(!result)throw new IncorrectResultSizeDataAccessException(1,0);
   String value;
   try(var rows=statement.getResultSet()){
    int columns=rows.getMetaData().getColumnCount();
    if(columns!=1)throw new IncorrectResultSetColumnCountException(1,columns);
    if(!rows.next())throw new IncorrectResultSizeDataAccessException(1,0);
    value=rows.getString(1); // Disconnect returns VOID; its value is ignored.
    if(rows.next())throw new IncorrectResultSizeDataAccessException(1,2);
   }
   if(statement.getMoreResults() || statement.getUpdateCount()!=-1)
    throw new IncorrectResultSizeDataAccessException("Resultado adicional de tiempo real no esperado.",1);
   return value;
  });
 }
 public void publish(){withDatabaseErrorTranslation(()->jdbc.queryForObject(
  "SELECT pliego.fn_realtime_publish(1000)",Integer.class));}
}
