package com.pliego.modules.notifications.gateway;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.notifications.application.OutboxMail;

@Repository
public class JdbcMailOutboxGateway extends JdbcGatewaySupport implements MailOutboxGateway {
 private final JdbcTemplate jdbc;
 public JdbcMailOutboxGateway(DatabaseExceptionTranslator errors,JdbcTemplate jdbc) {super(errors);this.jdbc=jdbc;}
 public OutboxMail claim() {
  return withDatabaseErrorTranslation(()->jdbc.query("SELECT correo_id,propietario,tipo,destinatario,intentos,datos::text FROM pliego.fn_mail_outbox_claim()",
   rs->rs.next()?new OutboxMail(rs.getLong("correo_id"),rs.getObject("propietario",UUID.class),rs.getString("tipo"),rs.getString("destinatario"),rs.getInt("intentos"),rs.getString("datos")):null));
 }
 public boolean complete(OutboxMail mail,String outcome,String error,String providerMessageId) {
  return withDatabaseErrorTranslation(()->jdbc.query("SELECT pliego.fn_mail_outbox_try_complete(?,?,?,?,?)",s->{
   s.setLong(1,mail.id());s.setObject(2,mail.owner());s.setString(3,outcome);s.setString(4,error);s.setString(5,providerMessageId);
  },rs->rs.next() && rs.getBoolean(1)));
 }
}
