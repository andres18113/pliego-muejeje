package com.pliego.modules.realtime;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.pliego.modules.realtime.application.RealtimeService;
import com.pliego.modules.realtime.application.RealtimeStreams;
import com.pliego.modules.realtime.gateway.RealtimeGateway;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RealtimeStreamsTest {
 @Mock RealtimeService service;
 @Mock org.springframework.web.servlet.mvc.method.annotation.SseEmitter emitter;
 @Test void sharedBudgetBoundsAdmissionsReadsAndCleanup() throws Exception {
  class Borrows {
   final AtomicInteger active=new AtomicInteger(),maximum=new AtomicInteger();
   final CountDownLatch fourth=new CountDownLatch(4),fifth=new CountDownLatch(5),release=new CountDownLatch(1);
   final java.util.Set<String> kinds=ConcurrentHashMap.newKeySet();
   void hold(String kind) throws InterruptedException {
    kinds.add(kind);maximum.accumulateAndGet(active.incrementAndGet(),Math::max);
    fourth.countDown();fifth.countDown();
    try{release.await();}finally{active.decrementAndGet();}
   }
  }
  var borrows=new Borrows();var cookies=new ConcurrentHashMap<java.util.UUID,String>();
  var blockAdmissions=new AtomicBoolean();
  when(service.connect(anyString(),any())).thenAnswer(call->{
   cookies.put(call.getArgument(1),call.getArgument(0));
   if(blockAdmissions.get())borrows.hold("admission");return "CONNECTED";
  });
  when(service.read(any(),any())).thenAnswer(call->{
   if("a".repeat(43).equals(cookies.get(call.getArgument(0))))borrows.hold("read");
   return new RealtimeGateway.Batch(false,"0",false,List.of());
  });
  doAnswer(call->{
   if("b".repeat(43).equals(cookies.get(call.getArgument(0))))borrows.hold("disconnect");
   return null;
  }).when(service).disconnect(any());
  var streams=new RealtimeStreams(service,new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
  var clients=Executors.newVirtualThreadPerTaskExecutor();
  try {
   streams.open("a".repeat(43),null);streams.open("b".repeat(43),null);
   long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
   while(borrows.active.get()<2 && System.nanoTime()<deadline)Thread.sleep(10);
   assertThat(borrows.kinds).contains("read","disconnect");
   blockAdmissions.set(true);
   for(int n=0;n<8;n++)clients.submit(()->streams.open("c".repeat(43),null));
   assertThat(borrows.fourth.await(3,TimeUnit.SECONDS)).isTrue();
   assertThat(borrows.fifth.await(300,TimeUnit.MILLISECONDS))
    .as("Admissions, reads and cleanup must share one four-borrow budget before entering transactions")
    .isFalse();
   assertThat(borrows.maximum.get()).isEqualTo(4);
   assertThat(borrows.kinds).containsExactlyInAnyOrder("read","disconnect","admission");
   assertThat(((Semaphore)org.springframework.test.util.ReflectionTestUtils.getField(streams,"database")).isFair()).isTrue();
   new com.pliego.modules.realtime.application.RealtimePublisher(service).publish();
   verify(service).publish();
  } finally {borrows.release.countDown();clients.shutdownNow();streams.shutdown();clients.close();}
 }
 @org.junit.jupiter.params.ParameterizedTest
 @org.junit.jupiter.params.provider.ValueSource(strings={"55P03","57014"})
 void admissionLockTimeoutUsesExistingConnectionLimitedContract(String sqlState) {
  var failure=new com.pliego.foundation.database.DatabaseExceptionTranslator()
   .translate(new java.sql.SQLException("synthetic timeout",sqlState));
  when(service.connect(anyString(),any())).thenThrow(failure);
  var streams=new RealtimeStreams(service,new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
  try {
   assertThatThrownBy(()->streams.open("a".repeat(43),null))
    .isInstanceOfSatisfying(RealtimeStreams.OpenFailure.class,error->assertThat(error.limited()).isTrue());
  } finally {streams.shutdown();}
 }
 @Test void admissionDoesNotMaskOtherDatabaseFailures() {
  var failure=new com.pliego.foundation.database.DatabaseExceptionTranslator()
   .translate(new java.sql.SQLException("synthetic contract failure","P1001"));
  when(service.connect(anyString(),any())).thenThrow(failure);
  var streams=new RealtimeStreams(service,new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
  try{assertThatThrownBy(()->streams.open("a".repeat(43),null)).isSameAs(failure);}
  finally{streams.shutdown();}
 }
 @Test void socketWritesNeverRetainADatabasePermit() throws Exception {
  when(service.read(any(),any())).thenReturn(
   new RealtimeGateway.Batch(true,"1",true,List.of(new RealtimeGateway.Event("1","order.changed","order","123"))),
   new RealtimeGateway.Batch(false,"1",false,List.of()));
  var streams=new RealtimeStreams(service,new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
  var permits=(Semaphore)org.springframework.test.util.ReflectionTestUtils.getField(streams,"database");
  var sends=new AtomicInteger();
  doAnswer(call->{assertThat(permits.availablePermits()).isEqualTo(4);sends.incrementAndGet();return null;})
   .when(emitter).send(any(org.springframework.web.servlet.mvc.method.annotation.SseEmitter.SseEventBuilder.class));
  try {
   org.springframework.test.util.ReflectionTestUtils.invokeMethod(streams,"pump",java.util.UUID.randomUUID(),
    null,emitter,new AtomicBoolean(),(Runnable)()->{});
   assertThat(sends.get()).isEqualTo(3);
  } finally {streams.shutdown();}
 }
 @Test void failedCleanupReleasesBudgetAndProcessSlot() throws Exception {
  when(service.connect(anyString(),any())).thenReturn("CONNECTED");
  when(service.read(any(),any())).thenReturn(new RealtimeGateway.Batch(false,"0",false,List.of()));
  var failure=new com.pliego.foundation.database.DatabaseExceptionTranslator()
   .translate(new java.sql.SQLException("synthetic lock timeout","55P03"));
  doThrow(failure).when(service).disconnect(any());
  var streams=new RealtimeStreams(service,new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
  try {
   streams.open("a".repeat(43),null);
   verify(service,timeout(3000)).disconnect(any());
   var permits=(Semaphore)org.springframework.test.util.ReflectionTestUtils.getField(streams,"database");
   var slots=(Semaphore)org.springframework.test.util.ReflectionTestUtils.getField(streams,"capacity");
   long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
   while(permits.availablePermits()!=4 && System.nanoTime()<deadline)Thread.sleep(10);
   assertThat(permits.availablePermits()).isEqualTo(4);assertThat(slots.availablePermits()).isEqualTo(128);
  } finally {streams.shutdown();}
 }
 @Test void heartbeatsContinueWhileEveryReadPermitIsHeld() throws Exception {
  when(service.connect(anyString(),any())).thenReturn("CONNECTED");
  var readCalls=new AtomicInteger();
  var firstRead=new CountDownLatch(1);
  when(service.read(any(),any())).thenAnswer(call->{
   readCalls.incrementAndGet();firstRead.countDown();return new RealtimeGateway.Batch(true,"0",false,List.of());
  });
  var streams=new RealtimeStreams(service,new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
  var permits=(Semaphore)org.springframework.test.util.ReflectionTestUtils.getField(streams,"database");
  var mvc=org.springframework.test.web.servlet.setup.MockMvcBuilders
   .standaloneSetup(new StreamEndpoint(streams)).build();
  try {
   var response=mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/events"))
    .andReturn().getResponse();
   assertThat(firstRead.await(3,TimeUnit.SECONDS)).isTrue();
   permits.acquire(4);
   int callsWhileHeld=readCalls.get();
   long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(21);
   while(heartbeatCount(response.getContentAsString())<2 && System.nanoTime()<deadline)Thread.sleep(20);
   assertThat(heartbeatCount(response.getContentAsString()))
    .as("An admitted stream must keep sending heartbeats while all database-read permits are held")
    .isGreaterThanOrEqualTo(2);
   assertThat(readCalls.get()).isEqualTo(callsWhileHeld);
  } finally {streams.shutdown();permits.release(4);}
 }
 private static long heartbeatCount(String wire){return wire.lines().filter(":heartbeat"::equals).count();}
 @org.springframework.web.bind.annotation.RestController
 static class StreamEndpoint {
  private final RealtimeStreams streams;
  StreamEndpoint(RealtimeStreams streams){this.streams=streams;}
  @org.springframework.web.bind.annotation.GetMapping(path="/events",produces="text/event-stream")
  public org.springframework.web.servlet.mvc.method.annotation.SseEmitter events(){return streams.open("a".repeat(43),null);}
 }
 @Test void slowReadsLeaveDatabaseCapacityForOtherRequests() throws Exception {
  var reading=new CountDownLatch(4);
  var fifthRead=new CountDownLatch(5);
  var unblock=new CountDownLatch(1);
  when(service.connect(anyString(),any())).thenReturn("CONNECTED");
  when(service.read(any(),isNull())).thenAnswer(call->{
   reading.countDown();fifthRead.countDown();
   unblock.await();
   return new RealtimeGateway.Batch(true,"0",true,List.of());
  });
  var streams=new RealtimeStreams(service,new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
  try {
   for(int n=0;n<4;n++)streams.open("a".repeat(43),null);
   assertThat(reading.await(5,TimeUnit.SECONDS)).isTrue();
   assertThat(fifthRead.await(300,TimeUnit.MILLISECONDS))
    .as("Stalled realtime reads must leave connections for REST in the eight-connection pool")
    .isFalse();
   assertThatThrownBy(()->streams.open("b".repeat(43),null))
    .isInstanceOfSatisfying(RealtimeStreams.OpenFailure.class,error->assertThat(error.limited()).isTrue());
   verify(service,times(4)).connect(anyString(),any());
  } finally {streams.shutdown();unblock.countDown();}
 }
 @Test void shutdownInterruptsIdleStreamsAndReleasesEveryLease() throws Exception {
  int subscribers=12;
  var reading=new CountDownLatch(subscribers);
  var released=new CountDownLatch(subscribers);
  when(service.connect(anyString(),any())).thenReturn("CONNECTED");
  when(service.read(any(),isNull())).thenAnswer(call->{
   assertThat(Thread.currentThread().isVirtual()).isTrue();
   reading.countDown();return new RealtimeGateway.Batch(true,"0",true,List.of());
  });
  doAnswer(call->{released.countDown();return null;}).when(service).disconnect(any());
  var streams=new RealtimeStreams(service,new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
  try {
   for(int n=0;n<subscribers;n++)streams.open("a".repeat(43),null);
   assertThat(reading.await(5,TimeUnit.SECONDS)).isTrue();
   streams.shutdown();
   assertThat(released.await(5,TimeUnit.SECONDS)).isTrue();
   assertThatThrownBy(()->streams.open("a".repeat(43),null)).isInstanceOf(RealtimeStreams.OpenFailure.class);
   verify(service,times(subscribers)).disconnect(any());
  } finally {streams.shutdown();}
 }
}
