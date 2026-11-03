package com.pliego.modules.realtime.application;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import com.pliego.foundation.database.DatabaseException;
import jakarta.annotation.PreDestroy;

/** See ADR0054. Idle streams occupy virtual threads, never JDBC connections. */
@Service
public class RealtimeStreams {
 public static final long RETRY_MS=3000;
 private final RealtimeService service;
 private final ExecutorService workers=Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("realtime-",0).factory());
 private final Semaphore capacity=new Semaphore(128);
 // One fair budget BEFORE every per-connection Spring transaction: four of
 // Hikari's eight slots. The independent publisher uses at most one more.
 private final Semaphore database=new Semaphore(4,true);
 private final ConcurrentHashMap<UUID,SseEmitter> streams=new ConcurrentHashMap<>();
 private final AtomicBoolean stopped=new AtomicBoolean();
 public RealtimeStreams(RealtimeService service){this.service=service;}
 public SseEmitter open(String cookie,Long cursor){
  if(cookie==null || !cookie.matches("[A-Za-z0-9_-]{43}"))throw new OpenFailure("UNAUTHORIZED");
  if(stopped.get() || !capacity.tryAcquire())throw new OpenFailure("LIMITED");
  UUID connection=UUID.randomUUID();
  try {
   if(!database.tryAcquire(2,TimeUnit.SECONDS))throw new OpenFailure("LIMITED");
   try {
    if(stopped.get())throw new OpenFailure("LIMITED");
    String state=service.connect(cookie,connection);
    if(!"CONNECTED".equals(state))throw new OpenFailure(state);
   }catch(DatabaseException e){
    if("55P03".equals(e.sqlState()) || "57014".equals(e.sqlState()))throw new OpenFailure("LIMITED");
    throw e;
   }finally{database.release();}
  }catch(InterruptedException e){
   Thread.currentThread().interrupt();capacity.release();throw new OpenFailure("LIMITED");
  }catch(RuntimeException e){capacity.release();throw e;}
  SseEmitter emitter=new SseEmitter(60_000L);
  AtomicBoolean finished=new AtomicBoolean();
  Runnable cleanup=()->{
   if(finished.compareAndSet(false,true)){
    streams.remove(connection);capacity.release();
    // A shutdown interrupt must not prevent a short best-effort cleanup; restore
    // it afterwards. Contended or failed cleanup falls back to the DB lease.
    boolean interrupted=Thread.interrupted();
    try{
     if(database.tryAcquire(100,TimeUnit.MILLISECONDS)){
      try{service.disconnect(connection);}finally{database.release();}
     }
    }catch(InterruptedException e){interrupted=true;}
    catch(RuntimeException ignored){/* Lease expires within 60 seconds. */}
    finally{if(interrupted)Thread.currentThread().interrupt();}
   }
  };
  emitter.onCompletion(cleanup);emitter.onTimeout(cleanup);emitter.onError(e->cleanup.run());
  streams.put(connection,emitter);
  try{workers.submit(()->pump(connection,cursor,emitter,finished,cleanup));}
  catch(RuntimeException e){cleanup.run();emitter.complete();throw e;}
  return emitter;
 }
 private void pump(UUID connection,Long cursor,SseEmitter emitter,AtomicBoolean finished,Runnable cleanup){
  long until=System.nanoTime()+java.time.Duration.ofSeconds(60).toNanos();
  long heartbeat=System.nanoTime()+java.time.Duration.ofSeconds(15).toNanos();
  try {
   emitter.send(SseEmitter.event().reconnectTime(RETRY_MS).comment("heartbeat"));
   while(!stopped.get() && !finished.get() && System.nanoTime()<until){
    com.pliego.modules.realtime.gateway.RealtimeGateway.Batch batch=null;
    if(database.tryAcquire(2,TimeUnit.SECONDS)){
     try{
      if(stopped.get() || finished.get() || System.nanoTime()>=until)break;
      batch=service.read(connection,cursor);
     }finally{database.release();}
    }
    if(stopped.get() || finished.get() || System.nanoTime()>=until)break;
    // Socket writes must never retain a database permit. Contention can
    // defer a read, but cannot defer the independent heartbeat/lifetime checks.
    if(batch!=null){
     if(!batch.open())break;
     if(batch.resync())emitter.send(SseEmitter.event().id(batch.cursor()).name("resync").data(Map.of("reason","replay-unavailable")));
     for(var event:batch.events())emitter.send(SseEmitter.event().id(event.id()).name(event.name())
      .data(Map.of("resourceType",event.resourceType(),"resourceId",event.resourceId())));
     // A cursor checkpoint also advances over events belonging to other users.
     if(!batch.resync() && !batch.cursor().equals(cursor==null?null:cursor.toString()))
      emitter.send(SseEmitter.event().id(batch.cursor()).comment("checkpoint"));
     cursor=Long.valueOf(batch.cursor());
    }
    if(System.nanoTime()>=heartbeat){emitter.send(SseEmitter.event().comment("heartbeat"));
     heartbeat=System.nanoTime()+java.time.Duration.ofSeconds(15).toNanos();}
    Thread.sleep(2000);
   }
  }catch(InterruptedException e){Thread.currentThread().interrupt();}
  catch(IOException | RuntimeException ignored){/* Client reconnects; no credentials or payloads in logs. */}
  finally{cleanup.run();emitter.complete();}
 }
 @PreDestroy public void shutdown(){
  stopped.set(true);streams.values().forEach(SseEmitter::complete);workers.shutdownNow();
 }
 public static final class OpenFailure extends RuntimeException {
  private final String state;
  public OpenFailure(String state){super("No se pudo abrir el canal de actualizaciones.");this.state=state;}
  public boolean limited(){return "LIMITED".equals(state);}
 }
}
