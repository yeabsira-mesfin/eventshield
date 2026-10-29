import {useState,useEffect,useCallback} from 'react';
import {EventOperations,MemberResources} from './EventOperations.jsx';

async function request(path,token,options={}){
  const response=await fetch('/api'+path,{...options,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(options.body?{'Content-Type':'application/json'}:{})}});
  if(!response.ok){const r=await response.json().catch(()=>({}));throw Error(r.error||'Request failed');}
  return response.json();
}
const formatted=d=>new Date(d).toLocaleString();
const tone=s=>['published','confirmed','resolved'].includes(s)?'success':['high','critical','open'].includes(s)?'danger':'muted';
function Badge({value}){return <span className={'badge badge-'+tone(value)}>{value}</span>}
const initial={title:'',venue:'Online',description:'',starts_at:'',capacity:100};
export default function App(){
  const [token,setToken]=useState('');
  const [user,setUser]=useState(null);
  const [email,setEmail]=useState('admin@eventshield.test');
  const [password,setPassword]=useState('');
  const [page,setPage]=useState('overview');
  const [events,setEvents]=useState([]);
  const [mine,setMine]=useState([]);
  const [metrics,setMetrics]=useState({});
  const [signals,setSignals]=useState({events:[],incidents:[],audits:[]});
  const [newEvent,setNewEvent]=useState(initial);
  const [selected,setSelected]=useState(null);
  const [types,setTypes]=useState([]);
  const [questions,setQuestions]=useState([]);
  const [answers,setAnswers]=useState({});
  const [chosenType,setChosenType]=useState('');
  const [attendeeName,setAttendeeName]=useState('');
  const [incidentTitle,setIncidentTitle]=useState('');
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const manager=!!user&&['Admin','Event Manager'].includes(user.role);
  const staff=!!user&&['Admin','Event Manager','Staff'].includes(user.role);
  const refresh=useCallback(async()=>{
    if(!token||!user)return;
    const calls=[
      request('/events',token).then(r=>setEvents(r.events)),
      request('/registrations/mine',token).then(r=>setMine(r.registrations))
    ];
    if(staff)calls.push(request('/dashboard',token).then(r=>setMetrics(r.metrics)));
    if(manager)calls.push(request('/security',token).then(setSignals));
    await Promise.all(calls);
  },[token,user,manager,staff]);
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[refresh]);
  async function perform(action,message){
    setBusy(true);setError('');setNotice('');
    try{await action();if(message)setNotice(message);await refresh();}
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  async function login(ev){
    ev.preventDefault();setBusy(true);setError('');
    try{const r=await request('/auth/login',null,{method:'POST',body:JSON.stringify({email,password})});setToken(r.token);setUser(r.user);setAttendeeName(r.user.name);setPassword('');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function details(event){
    setSelected(event);setChosenType('');setAnswers({});setError('');
    try{const r=await request('/events/'+event.id+'/configuration',token);setTypes(r.types);setQuestions(r.questions);}
    catch(e){setError(e.message);}
  }
  async function exportCsv(event){
    setBusy(true);setError('');
    try{
      const r=await fetch('/api/events/'+event.id+'/export',{headers:{Authorization:'Bearer '+token}});
      if(!r.ok)throw Error('Export was denied');
      const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='eventshield-attendees.csv';a.click();URL.revokeObjectURL(url);
      setNotice('Audited CSV exported');await refresh();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  if(!user)return <div className="login-wrap"><header className="login-logo"><b className="logo-square">◆</b> EVENTSHIELD <small>SECURE EVENT OPERATIONS</small></header><div className="login-grid"><section><span className="kicker">ENTERPRISE EVENT TECHNOLOGY</span><h1>Every event.<br/>Every detail.<br/><em>Protected.</em></h1><p>Plan registrations, monitor attendance, investigate security events and demonstrate access controls from a unified workspace.</p><div className="login-features"><span>◈ Security Center</span><span>◎ Registration operations</span><span>▥ Auditable workflows</span></div></section><form className="login-card" onSubmit={login}><span className="kicker">WORKSPACE ACCESS</span><h2>Welcome back</h2><p>Sign in using a locally seeded synthetic account.</p><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>Sign in securely →</button><small>Accounts: admin, manager, attendee or guest @eventshield.test. Use your own locally configured demo password.</small></form></div></div>;
  const menu=[['overview','Overview','▦'],['events','Events','▤'],['registrations','My registrations','◎'],...(manager?[['operations','Event setup','▣'],['security','Security Center','◈'],['audit','Audit & reports','▥']]:[])];
  return <div className="app">
    <aside className="sidebar"><div className="brand"><b className="logo-square">◆</b><div>EVENTSHIELD<small>OPERATIONS PLATFORM</small></div></div><span className="side-caption">WORKSPACE</span><nav aria-label="Main navigation">{menu.map(([key,label,icon])=><button key={key} className={page===key?'active':''} onClick={()=>{setPage(key);setError('');}}><span>{icon}</span>{label}</button>)}</nav><div className="sidebar-foot"><div className="online">● Synthetic demo data</div><div className="profile"><b>{user.name[0]}</b><span>{user.name}<small>{user.role}</small></span></div><button onClick={()=>{setToken('');setUser(null);setPage('overview');}}>Sign out</button></div></aside>
    <div className="main"><header className="topbar">Workspace / <strong>{menu.find(m=>m[0]===page)?.[1]}</strong><div><span className="demo-tag">DEMO ENVIRONMENT</span><span className="user-dot">{user.name[0]}</span></div></header>
    <main className="content">{error&&<div className="message error" role="alert">{error}<button onClick={()=>setError('')}>×</button></div>}{notice&&<div className="message success" role="status">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
    {page==='overview'&&<><div className="heading"><div><span className="kicker">OPERATIONS OVERVIEW</span><h1>Welcome, {user.name.split(' ')[0]}.</h1><p>Your events and operational security at a glance.</p></div><button className="secondary" onClick={()=>perform(refresh,'Updated')}>↻ Refresh</button></div><div className="metrics">{[['Total events',metrics.events??events.length,'▦'],['Confirmed',metrics.confirmed??mine.filter(r=>r.status==='confirmed').length,'◎'],['Waitlisted',metrics.waitlisted??mine.filter(r=>r.status==='waitlisted').length,'◷'],['High priority alerts',manager?(metrics.high_alerts??0):'Restricted','◈']].map(([name,value,icon])=><article className="metric" key={name}><div>{name}<span>{icon}</span></div><strong>{value}</strong><small>Current workspace</small></article>)}</div><div className="columns"><section className="panel"><div className="panel-title"><h2>Upcoming events</h2><button className="link" onClick={()=>setPage('events')}>View all →</button></div>{events.slice(0,5).map(e=><div className="event-row" key={e.id}><div className="date-icon">{new Date(e.starts_at).getDate()}<small>{new Date(e.starts_at).toLocaleString('en-US',{month:'short'})}</small></div><div className="grow"><strong>{e.title}</strong><small>{e.venue} · {e.confirmed}/{e.capacity} confirmed</small></div><Badge value={e.status}/></div>)}{!events.length&&<p className="empty">No events yet.</p>}</section><section className="panel"><h2>Security posture</h2><div className="security-feature"><span>◈</span><h3>Access protection enabled</h3><p>Role-based access, object-level authorization, security signals and audit trails.</p></div>{manager&&<button className="secondary wide" onClick={()=>setPage('security')}>Open Security Center →</button>}</section></div></>}
    {page==='events'&&<><div className="heading"><div><span className="kicker">EVENT OPERATIONS</span><h1>Event management</h1><p>Manage registration paths and track capacity.</p></div><span className="number-tag">{events.length} events</span></div>{manager&&<form className="panel" onSubmit={e=>{e.preventDefault();perform(async()=>{await request('/events',token,{method:'POST',body:JSON.stringify({...newEvent,capacity:Number(newEvent.capacity),starts_at:new Date(newEvent.starts_at).toISOString()})});setNewEvent(initial);},'Event draft created');}}><div className="panel-title"><h2>Create a new event</h2><small>Draft until published</small></div><div className="field-grid"><label>Event title<input minLength="4" required value={newEvent.title} placeholder="Annual security summit" onChange={e=>setNewEvent({...newEvent,title:e.target.value})}/></label><label>Venue<input required value={newEvent.venue} onChange={e=>setNewEvent({...newEvent,venue:e.target.value})}/></label><label>Start date<input type="datetime-local" required value={newEvent.starts_at} onChange={e=>setNewEvent({...newEvent,starts_at:e.target.value})}/></label><label>Capacity<input type="number" required min="1" max="100000" value={newEvent.capacity} onChange={e=>setNewEvent({...newEvent,capacity:e.target.value})}/></label></div><button className="primary" disabled={busy}>Create draft event</button></form>}
      <section className="panel"><div className="panel-title"><h2>Event directory</h2><input className="search" aria-label="Search events" placeholder="Search events..." value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="scroll"><table><thead><tr><th>Event</th><th>Start</th><th>Seats</th><th>Status</th><th>Actions</th></tr></thead><tbody>{events.filter(e=>(e.title+e.venue).toLowerCase().includes(search.toLowerCase())).map(e=><tr key={e.id}><td><strong>{e.title}</strong><small>{e.venue}</small></td><td>{formatted(e.starts_at)}</td><td>{e.confirmed}/{e.capacity}<small>{e.waitlisted} waiting</small></td><td><Badge value={e.status}/></td><td className="actions"><button onClick={()=>details(e)}>Details</button>{manager&&e.status!=='archived'&&<button disabled={busy} onClick={()=>perform(()=>request('/events/'+e.id,token,{method:'PATCH',body:JSON.stringify({status:e.status==='draft'?'published':'archived'})}),'Status updated')}>{e.status==='draft'?'Publish':'Archive'}</button>}{manager&&<button disabled={busy} onClick={()=>exportCsv(e)}>Export CSV</button>}</td></tr>)}</tbody></table></div>{!events.length&&<p className="empty">No events available.</p>}</section>
      {selected&&<section className="panel"><div className="panel-title"><h2>{selected.title}</h2><button className="secondary" onClick={()=>setSelected(null)}>Close</button></div><p>{selected.description||'Registration options and event controls'}</p><Badge value={selected.status}/>{selected.status==='published'&&<form className="form-space" onSubmit={e=>{e.preventDefault();perform(()=>request('/events/'+selected.id+'/registrations',token,{method:'POST',body:JSON.stringify({attendee_name:attendeeName,registration_type_id:chosenType||null,answers})}),'Registration submitted');}}><div className="field-grid"><label>Attendee name<input minLength="2" value={attendeeName} onChange={e=>setAttendeeName(e.target.value)} required/></label><label>Registration type<select value={chosenType} onChange={e=>setChosenType(e.target.value)}><option value="">General admission</option>{types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>{questions.filter(q=>!q.registration_type_id||q.registration_type_id===chosenType).map(q=><label className="ops-field" key={q.id}>{q.label}{q.required?' (required)':''}<input required={q.required} maxLength="500" value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/></label>)}<button className="primary" disabled={busy}>Register my account</button></form>}{manager&&<form className="inline-form" onSubmit={e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');perform(async()=>{await request('/events/'+selected.id+'/types',token,{method:'POST',body:JSON.stringify({name})});await details(selected);},'Registration type created');e.currentTarget.reset();}}><input name="name" placeholder="New registration type" minLength="2" required/><button className="secondary" disabled={busy}>Add type</button></form>}</section>}</>}
    {page==='operations'&&manager&&<EventOperations token={token} events={events} onUpdated={refresh}/>}
    {page==='registrations'&&<><div className="heading"><div><span className="kicker">ATTENDEE PORTAL</span><h1>My registrations</h1><p>Manage your own attendance and cancellations.</p></div><button className="secondary" onClick={()=>setPage('events')}>Browse events</button></div><section className="panel"><div className="scroll"><table><thead><tr><th>Event</th><th>Registered</th><th>Status</th><th>Action</th></tr></thead><tbody>{mine.map(r=><tr key={r.id}><td><strong>{r.title}</strong><small>{r.id.slice(0,8)}</small></td><td>{formatted(r.created_at)}</td><td><Badge value={r.status}/></td><td>{r.status!=='cancelled'&&<button className="secondary" disabled={busy} onClick={()=>perform(()=>request('/registrations/'+r.id+'/cancel',token,{method:'PATCH'}),'Registration cancelled')}>Cancel</button>}</td></tr>)}</tbody></table></div>{!mine.length&&<p className="empty">No registrations yet.</p>}</section>{mine.filter(r=>r.status==='confirmed').map(r=><section className="panel" key={r.id}><h2>Sessions and admission items: {r.title}</h2><MemberResources registration={r} token={token}/></section>)}</>}
    {page==='security'&&manager&&<><div className="heading"><div><span className="kicker">SECURITY OPERATIONS</span><h1>Security Center</h1><p>Investigate API access violations and operational signals.</p></div><button className="secondary" onClick={()=>perform(refresh,'Signals refreshed')}>↻ Refresh</button></div><div className="metrics">{[['Security signals',signals.events.length],['High severity',signals.events.filter(e=>['high','critical'].includes(e.severity)).length],['Open incidents',signals.incidents.filter(i=>i.status!=='resolved').length],['Audit records',signals.audits.length]].map(([name,count])=><div className="metric" key={name}><div>{name}<span>◈</span></div><strong>{count}</strong><small>Latest 100 records</small></div>)}</div><section className="panel"><div className="panel-title"><h2>Detection timeline</h2><small>No attendee PII in signal details</small></div><div className="scroll"><table><thead><tr><th>Event</th><th>Severity</th><th>Source</th><th>Timestamp</th></tr></thead><tbody>{signals.events.map(s=><tr key={s.id}><td><strong>{s.event_type.replaceAll('_',' ')}</strong><small>{s.details}</small></td><td><Badge value={s.severity}/></td><td>{s.source}</td><td>{formatted(s.created_at)}</td></tr>)}</tbody></table></div>{!signals.events.length&&<p className="empty">No events recorded.</p>}</section><section className="panel"><h2>Investigation cases</h2><form className="inline-form" onSubmit={e=>{e.preventDefault();perform(async()=>{await request('/incidents',token,{method:'POST',body:JSON.stringify({title:incidentTitle})});setIncidentTitle('');},'Incident created');}}><input minLength="4" placeholder="Investigation title" value={incidentTitle} onChange={e=>setIncidentTitle(e.target.value)} required/><button className="primary" disabled={busy}>Open case</button></form>{signals.incidents.map(i=><div className="event-row" key={i.id}><div className="grow"><strong>{i.title}</strong><small>{formatted(i.created_at)}</small></div><Badge value={i.status}/>{i.status!=='resolved'&&<button className="secondary" onClick={()=>perform(()=>request('/incidents/'+i.id,token,{method:'PATCH',body:JSON.stringify({status:'resolved'})}),'Case resolved')}>Resolve</button>}</div>)}</section></>}
    {page==='audit'&&manager&&<><div className="heading"><div><span className="kicker">ACCOUNTABILITY</span><h1>Audit & reports</h1><p>Recorded changes, exports and event actions.</p></div></div><section className="panel"><div className="scroll"><table><thead><tr><th>Action</th><th>Object</th><th>Timestamp</th></tr></thead><tbody>{signals.audits.map(a=><tr key={a.id}><td><strong>{a.action}</strong></td><td>{a.object_type}</td><td>{formatted(a.created_at)}</td></tr>)}</tbody></table></div>{!signals.audits.length&&<p className="empty">No audit actions yet.</p>}</section></>}
    </main></div>
  </div>;
}
