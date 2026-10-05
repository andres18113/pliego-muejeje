import pathlib,json,re,requests,hashlib,concurrent.futures,html,datetime
BASE=pathlib.Path(__file__).resolve().parent
files=list(BASE.glob('PLG-BK-*.json'))
def check(f):
 d=json.load(open(f));s=d['sources'][0]
 if 'catalogo.uns.edu.ar' not in s['url'] or s.get('http_status')!=200:return
 resp=requests.get(s['url'],timeout=40);match=re.search(r'<title[^>]*>(.*?)</title>',resp.text,re.S|re.I)
 if not match:return d['sku'],'MISSING_TITLE'
 title=html.unescape(re.sub('<[^>]*>','',match.group(1))).strip()
 s['observed_page_title']=title;s['title_check_response_sha256']=hashlib.sha256(resp.content).hexdigest();s['title_checked_at_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();f.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
 return d['sku'],title
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
 for i,result in enumerate(ex.map(check,files),1):
  if i%20==0:print(i,result,flush=True)
