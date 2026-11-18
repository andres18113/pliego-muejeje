"""Read published repository catalog into a FRESH disposable DB; compare V077/V078.
No R2 upload or metadata write. Requires the packaged current backend and the gate
runtime environment. Writes EXPLAIN/evidence only under /tmp/pliego-digital-duplicates.
"""
import importlib.util, json, os, statistics, subprocess, sys
from pathlib import Path
root=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(root/'scripts'),str(root/'backend/src/test/postgres18')]
from checkout_last_unit import query
from monetary_upgrade_gate import start
from full_journey_http_gate import admin_token
spec=importlib.util.spec_from_file_location('catalog_seed',root/'scripts/seed-development-catalog.py')
seed=importlib.util.module_from_spec(spec);sys.modules[spec.name]=seed;spec.loader.exec_module(seed)
# start() chooses its own HTTP port. Discover it from this process's arguments.
assert os.environ.get('PGPORT') == '55476', 'Disposable PostgreSQL :55476 only'
assert query("SELECT count(*) FROM pg_namespace WHERE nspname='pliego'") == '0', 'Requires a fresh empty database'
process=start(77)
try:
 args=Path(f'/proc/{process.pid}/cmdline').read_bytes().split(b'\0')
 port=next(a.decode().split('=')[1] for a in args if a.startswith(b'--server.port='))
 api=seed.PliegoApi('http://127.0.0.1:'+port)
 api.token=admin_token(int(query("SELECT min(usuario_id) FROM pliego.usuario WHERE rol='ADMIN'"))).removeprefix('Bearer ')
 seeds=[]
 for staging in seed.discover_staging(root/'covers'):
  for record in json.loads(staging.read_text())['libros']:
   b,e=record['libro'],record['edicion']
   if e['sku'] in seed.EXCLUDED_CATALOG_SKUS:continue
   evidence=seed.cover_evidence(e)
   seeds.append(seed.EditionSeed(e['sku'],b['titulo'],b.get('subtitulo'),tuple(a['nombre'] for a in b['autores']),
    seed.category_slug(b['categorias'][0]),e['editorial'],e['idioma'],e['formato'],e.get('paginas'),e.get('fechaPublicacion'),
    e['precio'],e.get('inventarioInicial') or 5,b.get('sinopsis'),e.get('isbn13'),e.get('ebookFileFormat'),
    e.get('audioDurationSeconds'),tuple(e.get('narrators') or []),b['categorias'][0],e['portada']['url'],
    evidence['coverLicense'],evidence['coverSourceUrl'],evidence['coverAttribution']))
 categories={c.slug:c for c in seed.CATEGORIES}
 for item in seeds:categories.setdefault(item.category,seed.CategorySeed(item.category,item.category_name or item.category))
 cats=seed.ensure_categories(api,tuple(categories.values()));publishers={}
 for i,item in enumerate(seeds):
  book=seed.ensure_book(api,item,cats[item.category])
  if item.publisher not in publishers:publishers[item.publisher]=seed.ensure_publisher(api,item.publisher)
  edition=seed.ensure_edition(api,item,book,publishers[item.publisher])
  if item.format in {'PAPERBACK','HARDCOVER'}:seed.ensure_minimum_stock(api,edition['editionId'],item.stock)
  if i%100==0:print('Seeded',i,flush=True)
 print('Catalog seeded:',len(seeds),query('SELECT formato,count(*) FROM pliego.edicion GROUP BY formato ORDER BY formato'),flush=True)
 query('ANALYZE')
 def measure(label):
  result={}
  for text in ['Cómo','como','García','garcia','niño','nino','9780306406157','libro']:
   sql=f"SELECT * FROM pliego.fn_catalog_search_global('{text}',NULL,NULL,NULL,NULL,NULL,'TITLE_ASC',0,20,'AUDIOBOOK')"
   samples=[]
   for i in range(16):
    plan=json.loads(query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql))[0]
    if i: samples.append(plan['Execution Time'])
   result[text]={'median_ms':round(statistics.median(samples),3),'min_ms':min(samples),'max_ms':max(samples),'rows':plan['Plan']['Actual Rows'],'shared_hit_blocks':plan['Plan'].get('Shared Hit Blocks')}
   Path(f'/tmp/pliego-digital-duplicates/explain-{label}-{text}.json').write_text(json.dumps(plan,indent=2))
  # Also expose the matching plan inside the public PL/pgSQL function.
  inner="SELECT e.edicion_id FROM pliego.edicion e JOIN pliego.libro l USING(libro_id) WHERE e.estado='ACTIVE' AND l.estado='ACTIVE' AND " + ("lower(l.titulo) LIKE '%cómo%'" if label=='before' else "l.search_title_folded LIKE '%como%'")
  Path(f'/tmp/pliego-digital-duplicates/explain-{label}-inner.txt').write_text(query('EXPLAIN (ANALYZE,BUFFERS) '+inner))
  return result
 before=measure('before')
 Path('/tmp/pliego-digital-duplicates/performance-before.json').write_text(json.dumps(before,indent=2))
finally:
 process.terminate();process.wait(timeout=20)
process=start(78)
try:
 query('ANALYZE')
 after=measure('after')
 Path('/tmp/pliego-digital-duplicates/performance-after.json').write_text(json.dumps(after,indent=2))
 print(json.dumps({'before':before,'after':after},indent=2),flush=True)
 print('migration role:',query('SELECT current_user,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user'),flush=True)
 print('extensions:',query('SELECT extname FROM pg_extension'),flush=True)
finally:
 process.terminate();process.wait(timeout=20)
