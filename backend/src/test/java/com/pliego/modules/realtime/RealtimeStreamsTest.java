package com.pliego.modules.realtime;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.pliego.modules.realtime.application.RealtimeService;
import com.pliego.modules.realtime.application.RealtimeStreams;
import com.pliego.modules.realtime.gateway.RealtimeGateway;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RealtimeStreamsTest {
 @Mock RealtimeService service;
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
  var streams=new RealtimeStreams(service);
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
