package com.pliego.modules.realtime.gateway;

import java.util.List;
import java.util.UUID;

public interface RealtimeGateway {
 String connect(String cookieHash, UUID connection);
 Batch read(UUID connection, Long cursor);
 void disconnect(UUID connection);
 void publish();
 record Event(String id,String name,String resourceType,String resourceId) {}
 record Batch(boolean open,String cursor,boolean resync,List<Event> events) {}
}
