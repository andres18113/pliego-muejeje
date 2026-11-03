import com.sun.tools.attach.VirtualMachine;
import javax.management.*;
import javax.management.remote.*;
import javax.management.openmbean.CompositeData;

/** Local attach only: never enables a public JMX listener. CSV on stdout. */
class SSECapacityJmx {
 public static void main(String[] args) throws Exception {
  var vm=VirtualMachine.attach(args[0]);
  String address=vm.startLocalManagementAgent(); vm.detach();
  try(var connector=JMXConnectorFactory.connect(new JMXServiceURL(address))) {
   var server=connector.getMBeanServerConnection();
   ObjectName pool=new ObjectName("com.zaxxer.hikari:type=Pool (CapacityPool)");
   if(!server.isRegistered(pool)) throw new IllegalStateException("Main CapacityPool MBean absent");
   ObjectName config=new ObjectName("com.zaxxer.hikari:type=PoolConfig (CapacityPool)");
   var os=new ObjectName("java.lang:type=OperatingSystem");
   var memory=new ObjectName("java.lang:type=Memory");
   System.out.println("epoch_ms,active,idle,total,pending,cpu_ns,heap_used,heap_committed,gc_count,gc_ms,threads,pool_max,pool_min,heap_max,nonheap_used");
   while(true) {
    long count=0,ms=0;
    for(var gc:server.queryNames(new ObjectName("java.lang:type=GarbageCollector,*"),null)) {
     count+=(Long)server.getAttribute(gc,"CollectionCount"); ms+=(Long)server.getAttribute(gc,"CollectionTime");
    }
    var heap=(CompositeData)server.getAttribute(memory,"HeapMemoryUsage");
    var nonheap=(CompositeData)server.getAttribute(memory,"NonHeapMemoryUsage");
    System.out.printf("%d,%s,%s,%s,%s,%s,%s,%s,%d,%d,%s,%s,%s,%s,%s%n",System.currentTimeMillis(),
      server.getAttribute(pool,"ActiveConnections"),server.getAttribute(pool,"IdleConnections"),
      server.getAttribute(pool,"TotalConnections"),server.getAttribute(pool,"ThreadsAwaitingConnection"),
      server.getAttribute(os,"ProcessCpuTime"),heap.get("used"),heap.get("committed"),count,ms,
      server.getAttribute(new ObjectName("java.lang:type=Threading"),"ThreadCount"),
      server.getAttribute(config,"MaximumPoolSize"),server.getAttribute(config,"MinimumIdle"),heap.get("max"),nonheap.get("used"));
    System.out.flush(); Thread.sleep(250);
   }
  }
 }
}
