package com.pliego.modules.notifications.application;

import java.util.UUID;
public record OutboxMail(long id,UUID owner,String type,String recipient,int attempts,String data) {
 @Override public String toString() { return "OutboxMail[id="+id+", type="+type+", attempts="+attempts+"]"; }
}
