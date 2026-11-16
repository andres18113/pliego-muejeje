import importlib.util, pathlib, unittest
spec=importlib.util.spec_from_file_location('soak',pathlib.Path(__file__).with_name('soak.py'))
s=importlib.util.module_from_spec(spec)
if spec.loader and pathlib.Path(spec.origin).exists(): spec.loader.exec_module(s)
class SoakTests(unittest.TestCase):
 def test_management_refuses_external_or_ambiguous_address(self):
  for url in ['http://pliegolibros.com:8081/actuator/prometheus','http://localhost:8081/actuator/prometheus','http://127.0.0.1:8081/x','http://127.0.0.1:8081/actuator/prometheus?x=1','http://a@127.0.0.1:8081/actuator/prometheus']:
   with self.subTest(url=url), self.assertRaises(ValueError): s.validate_management(url)
 def test_management_accepts_loopback_only(self):
  self.assertIsNone(s.validate_management('http://127.0.0.1:8081/actuator/prometheus'))
 def test_normal_jit_refuses_workarounds(self):
  for flag in ['-Xint','-XX:TieredStopAtLevel=1','-XX:-TieredCompilation','-XX:CompileCommand=exclude,x','-XX:-UseCompiler']:
   with self.subTest(flag=flag), self.assertRaises(ValueError): s.validate_jit('-Xmx1280m '+flag)
 def test_normal_jit_accepts_original_flags(self):
  self.assertIsNone(s.validate_jit('-Xms256m -Xmx1280m -XX:+ExitOnOutOfMemoryError -XX:NativeMemoryTracking=summary'))
 def test_empty_metrics_rejected(self):
  with self.assertRaises(ValueError): s.validate_scrape(b'# no metrics\n')
 def test_real_metrics_required(self):
  self.assertIsNone(s.validate_scrape(b'process_uptime_seconds 4.0\njvm_threads_live_threads 24\n'))
 def test_memory_oom_event_is_failure(self):
  self.assertEqual(['oom_kill'],s.memory_failures({'high':4,'oom_kill':0},{'high':5,'oom_kill':1}))
 def test_memory_high_is_recorded_not_invented_failure(self):
  self.assertEqual([],s.memory_failures({'high':4},{'high':9}))

class LoadTargetTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  import importlib.util
  spec=importlib.util.spec_from_file_location('load',pathlib.Path(__file__).with_name('load.py'));cls.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.module)
 def test_production_refused_even_when_explicitly_allowed(self):
  with self.assertRaisesRegex(ValueError,'production'):self.module.validate_target('http://api.pliegolibros.com:80','api.pliegolibros.com')
 def test_exact_allowlist_required(self):
  with self.assertRaisesRegex(ValueError,'allowlist'):self.module.validate_target('http://127.0.0.1:8080','127.0.0.10')
 def test_tunnel_allowed(self):
  self.assertEqual(['127.0.0.1'],self.module.validate_target('http://127.0.0.1:8080','127.0.0.1'))
 def test_public_literal_refused(self):
  with self.assertRaisesRegex(ValueError,'private'):self.module.validate_target('http://8.8.8.8:8080','8.8.8.8')

if __name__=='__main__': unittest.main()
