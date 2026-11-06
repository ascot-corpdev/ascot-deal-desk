// In-memory stand-in for supabase-js: tables of {id, doc, updated_at, updated_by}, a trigger-like stamp,
// realtime postgres_changes callbacks and presence. Test hooks live on window.__mock.
(function(){
  const clone = o => JSON.parse(JSON.stringify(o));
  let tick = 0;
  const stamp = () => { tick++; return new Date(Date.UTC(2026,10,4,12,0,0) + tick*1000).toISOString().replace("Z", "." + String(tick).padStart(6,"0").slice(-3) + "+00:00"); };
  const ME = "u1", OTHER = "u2";
  const store = { deals:{}, bankers:{}, notes:{}, history:{}, settings:{}, profiles:{
    [ME]:{id:ME, username:"corpdev2", display_name:"Corp Dev 2", role:"corpdev"},
    [OTHER]:{id:OTHER, username:"corpdev1", display_name:"Corp Dev 1", role:"corpdev"} } };
  const log = [];
  let hid = 0;
  const SKIP = ["updatedAt","updatedBy","updatedByName","stageSince"];
  function hist(table, id, op, oldDoc, newDoc, by, at){
    if(!["deals","bankers"].includes(table) || window.__noHistory) return;
    let changes;
    if(op==="update"){ changes={}; const keys=new Set([...Object.keys(oldDoc||{}), ...Object.keys(newDoc||{})]);
      for(const k of keys){ if(SKIP.includes(k)) continue; const a=JSON.stringify((oldDoc||{})[k]), b=JSON.stringify((newDoc||{})[k]); if(a!==b) changes[k]={from:(oldDoc||{})[k]??null, to:(newDoc||{})[k]??null}; }
      if(!Object.keys(changes).length) return; }
    else changes={doc:clone(op==="insert"?newDoc:oldDoc)};
    hid++; store.history[hid]={id:hid, tbl:table, record_id:id, op, changes:clone(changes), changed_at:at||new Date().toISOString(), changed_by:by};
  }
  const pgCbs = [];
  const presCbs = [];
  const M = window.__mock = {
    store, log, tracked:undefined, presenceState:{}, bumpBeforeNextUpdate:null, channels:[],
    seed(table, id, doc){ store[table][id] = {id, doc:clone(doc), updated_at:stamp(), updated_by:OTHER}; },
    hist, // tests can add past history rows: hist(table,id,op,old,new,by,isoTime)
    // Another user's save straight to the database (with or without the realtime ping)
    otherSave(table, id, patch, {notify=true, name="Corp Dev 1"}={}){
      const r = store[table][id]; const old = clone(r.doc);
      r.doc = {...r.doc, ...patch, updatedBy:OTHER, updatedByName:name, updatedAt:Date.now()};
      hist(table, id, "update", old, r.doc, OTHER);
      r.updated_at = stamp(); r.updated_by = OTHER;
      if(notify) M.ping(table);
    },
    otherDelete(table, id, {notify=true}={}){ hist(table, id, "delete", store[table][id].doc, null, OTHER); delete store[table][id]; if(notify) M.ping(table); },
    ping(table){ pgCbs.filter(c=>c.table===table).forEach(c=>c.cb({})); },
    setOthers(list){ M.presenceState = {}; list.forEach((p,i)=>{ M.presenceState["k"+i] = [{...p, presence_ref:"r"+i}]; }); presCbs.forEach(cb=>cb()); },
    doc(table, id){ return store[table][id] ? clone(store[table][id].doc) : null; },
    row(table, id){ return store[table][id] ? clone(store[table][id]) : null; }
  };

  function query(table){
    const st = {op:"select", eqs:[], gtes:[], ins:[], ord:null, lim:null, wantRows:false, single:false, vals:null};
    const b = {
      select(){ if(st.op==="select") st.op="select"; else st.wantRows=true; return b; },
      eq(c, v){ st.eqs.push([c, v]); return b; },
      order(c, o){ st.ord=[c, !(o&&o.ascending===false)]; return b; }, limit(n){ st.lim=n; return b; },
      gte(c, v){ st.gtes.push([c, v]); return b; }, in(c, v){ st.ins.push([c, v]); return b; },
      maybeSingle(){ st.single=true; return b; },
      upsert(row){ st.op="upsert"; st.vals=row; return b; },
      insert(rows){ st.op="insert"; st.vals=rows; return b; },
      update(vals){ st.op="update"; st.vals=vals; return b; },
      delete(){ st.op="delete"; return b; },
      then(res, rej){ return Promise.resolve().then(run).then(res, rej); }
    };
    const match = r => st.eqs.every(([c,v]) => String(r[c]) === String(v)) && st.gtes.every(([c,v]) => String(r[c]) >= String(v)) && st.ins.every(([c,v]) => v.map(String).includes(String(r[c])));
    const shape = rows => { if(st.ord){ const [c,asc]=st.ord; rows.sort((a,b)=>(String(a[c])<String(b[c])?-1:String(a[c])>String(b[c])?1:0)*(asc?1:-1)); } return st.lim ? rows.slice(0, st.lim) : rows; };
    function run(){
      const T = store[table];
      if(table === "profiles"){
        const rows = Object.values(T).filter(match).map(clone);
        return st.single ? {data:rows[0]||null, error:null} : {data:rows, error:null};
      }
      if(table === "settings" && window.__noSettings) return {data:null, error:{code:"PGRST205", message:"Could not find the table 'public.settings' in the schema cache"}};
      if(table === "history" && window.__noHistory) return {data:null, error:{code:"PGRST205", message:"Could not find the table 'public.history' in the schema cache"}};
      if(st.op === "select"){
        const rows = shape(Object.values(T).filter(match).map(clone));
        return st.single ? {data:rows[0]||null, error:null} : {data:rows, error:null};
      }
      if(st.op === "insert"){
        if(window.__denyInsert===table) return {data:null, error:{code:"42501", message:'new row violates row-level security policy for table "'+table+'"'}};
        const list = Array.isArray(st.vals) ? st.vals : [st.vals];
        if(list.some(r=>T[r.id])) return {data:null, error:{code:"23505", message:"duplicate key value violates unique constraint"}};
        list.forEach(r=>{ T[r.id]={id:r.id, doc:clone(r.doc), updated_at:stamp(), updated_by:ME}; hist(table, r.id, "insert", null, r.doc, ME); });
        log.push({op:"insert", table, n:list.length});
        return {data:null, error:null};
      }
      if(st.op === "upsert"){
        log.push({op:"upsert", table, id:st.vals.id});
        const prev = T[st.vals.id];
        T[st.vals.id] = {id:st.vals.id, doc:clone(st.vals.doc), updated_at:stamp(), updated_by:ME};
        hist(table, st.vals.id, prev?"update":"insert", prev&&prev.doc, st.vals.doc, ME);
        return {data:null, error:null};
      }
      if(st.op === "update"){
        const idEq = st.eqs.find(e=>e[0]==="id");
        const bump = M.bumpBeforeNextUpdate;
        if(bump && idEq && bump.table===table && bump.id===idEq[1]){ M.bumpBeforeNextUpdate=null; M.otherSave(table, bump.id, bump.patch, {notify:false}); }
        const rows = Object.values(T).filter(match);
        log.push({op:"update", table, id:idEq&&idEq[1], matched:rows.length, cas:st.eqs.some(e=>e[0]==="updated_at")});
        rows.forEach(r=>{ const old=r.doc; r.doc = clone(st.vals.doc); r.updated_at = stamp(); r.updated_by = ME; hist(table, r.id, "update", old, r.doc, ME); });
        return {data:rows.map(r=>({id:r.id})), error:null};
      }
      if(st.op === "delete"){
        const rows = Object.values(T).filter(match);
        rows.forEach(r=>{ hist(table, r.id, "delete", r.doc, null, ME); delete T[r.id]; });
        log.push({op:"delete", table, ids:rows.map(r=>r.id)});
        return {data:rows.map(r=>({id:r.id})), error:null};
      }
    }
    return b;
  }

  (window.__seed||[]).forEach(([t,id,doc])=>M.seed(t,id,doc));
  const client = {
    from: query,
    auth: {
      async getSession(){ return {data:{session: M.signedOut ? null : {user:{id:ME}, access_token:"t"}}}; },
      async signInWithPassword(){ return {data:{session:{user:{id:ME}}}, error:null}; },
      async signOut(){ M.signedOut = true; return {error:null}; },
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async updateUser(){ return {error:null}; }
    },
    channel(name, opts){
      const ch = { name, opts,
        on(type, filter, cb){ if(type==="postgres_changes") pgCbs.push({table:filter.table, cb}); if(type==="presence") presCbs.push(cb); return ch; },
        subscribe(cb){ if(cb) setTimeout(()=>cb("SUBSCRIBED"), 0); return ch; },
        track(p){ M.tracked = clone(p); return Promise.resolve("ok"); },
        untrack(){ M.tracked = null; M.untracked = true; return Promise.resolve("ok"); },
        presenceState(){ return M.presenceState; }
      };
      M.channels.push(name);
      return ch;
    },
    removeChannel(ch){ M.removed = (M.removed||[]).concat(ch.name); }
  };
  window.supabase = { createClient(){ return client; } };
})();
