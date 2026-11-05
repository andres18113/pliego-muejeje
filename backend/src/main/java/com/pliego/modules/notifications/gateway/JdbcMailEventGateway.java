package com.pliego.modules.notifications.gateway;

import java.sql.Timestamp;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.notifications.application.MailProviderEvent;

@Repository
public class JdbcMailEventGateway extends JdbcGatewaySupport implements MailEventGateway {
 private final JdbcTemplate jdbc;
 public JdbcMailEventGateway(DatabaseExceptionTranslator errors,JdbcTemplate jdbc) {super(errors);this.jdbc=jdbc;}
 public boolean record(MailProviderEvent event) {
  return withDatabaseErrorTranslation(()->jdbc.query("SELECT pliego.fn_mail_event_record(?,?,?,?,?,?)",s->{
   s.setString(1,event.eventId());s.setString(2,event.messageId());s.setString(3,event.status());
   s.setString(4,event.reason());s.setTimestamp(5,Timestamp.from(event.occurredAt()));
   s.setString(6,"MAILTRAP");
  },rs->rs.next()&&rs.getBoolean(1)));
 }
 public boolean projectNext() {
  return withDatabaseErrorTranslation(()->Boolean.TRUE.equals(jdbc.queryForObject("SELECT pliego.fn_mail_event_project_next()",Boolean.class)));
 }
}
