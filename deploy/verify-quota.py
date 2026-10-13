import subprocess,time,json,uuid,hashlib,concurrent.futures
from pathlib import Path
name='meals-quota-db-'+uuid.uuid4().hex[:8]
def docker(*args,input=None):
 r=subprocess.run(['docker',*args],input=input,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def ready(initial=False):
 for _ in range(150):
  initialized=not initial or 'init process complete' in docker('logs',name)
  if initialized and subprocess.run(['docker','exec',name,'pg_isready','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:return
  time.sleep(.1)
 raise RuntimeError('Postgres not ready')
def sql(s):return docker('exec','-i',name,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At',input=s)
def reserve(client,limit=30,per=5):
 digest=hashlib.sha256(client.encode()).hexdigest()
 return json.loads(sql("select public.reserve_model_call('%s',%d,%d,%d);"%(digest,limit,per,per)))
try:
 docker('run','-d','--name',name,'--network','none','--memory','512m','--cpus','1','-e','POSTGRES_PASSWORD=temporary-quota-test','postgres:17-alpine')
 ready(True)
 sql('create role anon; create role authenticated; create role service_role;')
 sql(Path('deploy/supabase-quota.sql').read_text())
 assert reserve('same-client',3,2)['allowed']
 assert reserve('same-client',3,2)['allowed']
 assert not reserve('same-client',3,2)['allowed']
 docker('restart',name);ready()
 assert not reserve('same-client',3,2)['allowed']
 assert reserve('other-client',3,2)['allowed']
 assert not reserve('third-client',3,2)['allowed']
 print('PASS PostgreSQL: personal/global caps and restart persistence',flush=True)
 for role in ['anon','authenticated']:
  r=subprocess.run(['docker','exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input="set role %s; select public.reserve_model_call(repeat('a',64),30,5,5);"%role,text=True,capture_output=True)
  assert r.returncode!=0 and 'permission denied' in r.stderr
 sql("set role service_role; select public.reserve_model_call(repeat('a',64),30,5,5);")
 print('PASS PostgreSQL permissions: anonymous/authenticated denied, service_role accepted',flush=True)
 sql('truncate quota_private.days cascade;')
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:results=list(pool.map(lambda i:reserve('parallel-'+str(i)),range(50)))
 assert sum(bool(x['allowed']) for x in results)==30
 assert sql('select total from quota_private.days;')=='30'
 print('PASS concurrent reservations: exactly 30 of 50 accepted, no quota overshoot',flush=True)
finally:subprocess.run(['docker','rm','-fv',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
