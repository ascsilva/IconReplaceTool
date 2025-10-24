"use client";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, CheckSquare, FolderOpen, RefreshCcw, Replace, Save, Upload, X, Info, Square, Wand2 } from "lucide-react";

// ===== Utils =====
async function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    try {
      if (!file || file.size === 0) return reject(new Error("Ficheiro vazio ou inválido."));
      // Para processamento interno podemos continuar com ObjectURL (rápido)
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ img }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Falha ao carregar imagem '${file?.name || "(sem nome)"}'.`)); };
      img.src = url;
    } catch (e) {
      reject(e);
    }
  });
}

function drawToCanvas(imgOrCanvas, maxSize = 2048) {
  const src = imgOrCanvas instanceof HTMLCanvasElement ? imgOrCanvas : (()=>{ const c=document.createElement('canvas'); c.width=imgOrCanvas.width; c.height=imgOrCanvas.height; c.getContext('2d').drawImage(imgOrCanvas,0,0); return c; })();
  const canvas = document.createElement("canvas");
  let w = src.width, h = src.height;
  const scale = Math.min(maxSize / Math.max(w, h), 1);
  w = Math.round(w * scale); h = Math.round(h * scale);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

function aHash(img, size = 8) {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const gray = [];
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray.push(g);
  }
  const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
  let bits = 0n;
  for (let i = 0; i < gray.length; i++) bits = (bits << 1n) | (gray[i] > avg ? 1n : 0n);
  return bits; // 64 bits
}

function hammingDistance(a, b) { let x = a ^ b; let d = 0; while (x) { d++; x &= x - 1n; } return d; }

function edgeCanvasFromCanvas(canvas) {
  const w = canvas.width, h = canvas.height;
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const sctx = canvas.getContext("2d"); const dctx = out.getContext("2d");
  const src = sctx.getImageData(0,0,w,h); const dst = dctx.createImageData(w,h);
  const d = src.data, o = dst.data;
  const gxK = [-1,0,1,-2,0,2,-1,0,1]; const gyK = [-1,-2,-1,0,0,0,1,2,1];
  const gray = new Float32Array(w*h);
  for(let y=0,p=0;y<h;y++) for(let x=0;x<w;x++,p+=4) gray[y*w+x] = 0.299*d[p]+0.587*d[p+1]+0.114*d[p+2];
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
    let gx=0,gy=0,k=0; for(let j=-1;j<=1;j++) for(let i=-1;i<=1;i++,k++){ const v=gray[(y+j)*w+(x+i)]; gx+=gxK[k]*v; gy+=gyK[k]*v; }
    const mag = Math.min(255, Math.hypot(gx, gy)); const idx=(y*w+x)*4; o[idx]=o[idx+1]=o[idx+2]=mag; o[idx+3]=255;
  }
  dctx.putImageData(dst,0,0); return out;
}

function prepareForHash(canvas){ return edgeCanvasFromCanvas(canvas); }
function extFromName(name){ const i=name.lastIndexOf('.'); return i>=0?name.slice(i+1).toLowerCase():''; }
function baseName(name){ const dot=name.lastIndexOf('.'); let b=dot>=0?name.slice(0,dot):name; return b.toLowerCase().replace(/[-_](copy|final|novo|new)$/,'').replace(/[@_-]?\d+x$/,'').replace(/[-_]??\d+$/,'').replace(/-(filled|outline|solid|regular)$/,'').replace(/\s+/g,''); }
async function canvasFromAnyImageFile(file){ if(!file||file.size===0) throw new Error('Ficheiro vazio ou corrompido.'); try{ if(window.createImageBitmap){ const bmp=await createImageBitmap(file); const c=document.createElement('canvas'); c.width=bmp.width; c.height=bmp.height; c.getContext('2d').drawImage(bmp,0,0); bmp.close(); return drawToCanvas(c,2048);} }catch(e){ console.debug('fallback Image()',e);} const {img}=await loadImageFromFile(file); return drawToCanvas(img,2048); }
async function blobFromCanvasAsFormat(canvas, mime='image/png', quality=0.92){ return new Promise(r=>canvas.toBlob(b=>r(b), mime, quality)); }

// ===== Aliases (nome normalizado) =====
const ALIAS_GROUPS = [
  ['warning','alert','caution','attention','sign_warning','triangle_warning','exclamation'],
  ['info','information','circle_info','i'],
  ['error','danger','stop','close','x','times','cross'],
  ['check','ok','success','tick','done'],
  ['doc','document','file','paper','sheet'],
  ['download','arrow_down','saveas'],
  ['upload','arrow_up','import'],
  ['refresh','reload','sync','rotate','retry'],
  ['save','disk','floppy'],
  ['search','magnifier','loupe'],
  ['lock','secure','padlock','locker'],
  ['user','person','profile','account'],
  ['settings','gear','cog','preferences'],
  ['trash','bin','delete','remove'],
  ['edit','pencil','write'],
];
function aliasSetFromName(n){
  const b = baseName(n);
  const found = ALIAS_GROUPS.find(g => g.some(x => b.includes(x)));
  if (!found) return new Set([b]);
  return new Set(found);
}

export default function IconReplaceToolV28_Aliases_Report(){
  const [preview, setPreview] = useState(null); // {title, destUrl, srcUrl}

  const [sourceFile, setSourceFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [sourceInfo, setSourceInfo] = useState(null); // name,width,height
  const [threshold, setThreshold] = useState(90);
  const [mustMatchDims] = useState(true);
  const [folderFiles, setFolderFiles] = useState([]);
  const [candidates, setCandidates] = useState([]); // {file, score, reason, previewUrl}
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [useFSA, setUseFSA] = useState(false);
  const [dirHandle, setDirHandle] = useState(null);
  const [progress, setProgress] = useState({done:0,total:0});
  const [analysisDone, setAnalysisDone] = useState(false);
  const [runtimeEnv, setRuntimeEnv] = useState('desconhecido');
  const [isSandbox, setIsSandbox] = useState(false);
  const [useNameMatch, setUseNameMatch] = useState(true);
  const [sampleDestName, setSampleDestName] = useState('');
  const [filterBySampleBase, setFilterBySampleBase] = useState(true);
  const [report, setReport] = useState(null); // {replaced:[], failed:[], ignored:[]}

  const [targetDir, setTargetDir] = useState(null); // NOVO: pasta destino para escrever

  const dirInputRef = useRef(null);

  // Helper: ler ficheiro → DataURL (para pré-visualização dentro do Canvas/iframe)
  function fileToDataURL(file){
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error("Falha ao ler DataURL"));
      fr.readAsDataURL(file);
    });
  }

  // Detecta ambiente + FSA
  useEffect(()=>{
    const inIframe = (()=>{ try { return window.self !== window.top; } catch { return true; } })();
    const hasFSA = !!window.showDirectoryPicker; setUseFSA(hasFSA && !inIframe);
    setRuntimeEnv(inIframe? 'Canvas/iFrame (FSA bloqueado)' : 'Standalone (FSA disponível)');
    setIsSandbox(inIframe);
    if(inIframe) setLog(l=>[...l, 'ℹ️ Canvas detetado: usar "Carregar pasta (compatibilidade)". Pré-visualização via DataURL ativada.']);
  },[]);

  // Limpeza de ObjectURLs (não aplicável a DataURL)
  const previousUrlsRef = useRef([]);
  useEffect(()=>{
    if (isSandbox) return;
    previousUrlsRef.current.forEach(u=>{ try{ URL.revokeObjectURL(u); }catch{} });
    previousUrlsRef.current = candidates
      .map(c=>c.previewUrl)
      .filter(Boolean)
      .filter(u=>u.startsWith('blob:'));
    return () => {
      previousUrlsRef.current.forEach(u=>{ try{ URL.revokeObjectURL(u); }catch{} });
      previousUrlsRef.current = [];
    };
  },[candidates, isSandbox]);

  const closePreview = () => { setPreview(null); };

  function onFolderInputChange(e){
    const list = Array.from(e.target.files||[]).filter(f=>extFromName(f.name)==='png' && (f.type?.startsWith('image/') ?? true));
    setDirHandle(null); // garantir que não estamos em FSA
    setFolderFiles(list);
    setLog(l=>[...l, `Carregados ${list.length} PNG (modo compatibilidade)`]);
  }

  async function onSourceChange(e){
    const f=e.target.files?.[0]; setSourceFile(f||null); if(!f) return;
    try{
      const {img}=await loadImageFromFile(f);
      const url = isSandbox ? await fileToDataURL(f) : URL.createObjectURL(f);
      setSourceUrl(url);
      setSourceInfo({name:f.name,width:img.width,height:img.height});
      setLog(l=>[...l, `Fonte: ${f.name} (${img.width}×${img.height}px)`]);
    }catch(err){ setSourceInfo(null); setLog(l=>[...l, `❌ Erro a ler fonte: ${err.message||err}`]); }
  }

  async function pickFolderFSA(){
    try{
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setDirHandle(handle);
      const acc = [];
      for await (const [name, entry] of handle.entries()){
        if (entry.kind==='file' && extFromName(name)==='png'){
          const f = await entry.getFile();
          Object.defineProperty(f, 'webkitRelativePath', { value: name });
          acc.push(f);
        }
      }
      setFolderFiles(acc);
      setLog(l=>[...l, `Diretoria selecionada (FSA): ${acc.length} PNG`]);
    }catch(e){ setLog(l=>[...l, `❌ Erro a abrir diretoria FSA: ${e?.message||e}`]); }
  }

  // NOVO: escolher pasta alvo para gravar ficheiros alterados
  async function pickTargetFolder(){
    try{
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setTargetDir(handle);
      setLog(l=>[...l, `📁 Pasta destino selecionada: ${handle.name}`]);
    }catch(e){ setLog(l=>[...l, `❌ Erro a selecionar pasta destino: ${e?.message||e}`]); }
  }

  async function analyse(){
    setReport(null);
    if(!sourceFile || folderFiles.length===0){ setLog(l=>[...l,'⚠️ Fonte e pasta são obrigatórios']); return; }
    setBusy(true); setCandidates([]); setSelected(new Set()); setAnalysisDone(false);
    const total = folderFiles.length; setProgress({done:0,total:total});

    const srcCanvas = await canvasFromAnyImageFile(sourceFile);
    const srcW = srcCanvas.width, srcH = srcCanvas.height;
    const srcHash = aHash(prepareForHash(srcCanvas));

    const out=[]; let processed=0, skippedDims=0, below=0, errors=0;
    for(const f of folderFiles){
      try{
        if (useNameMatch && sourceFile && f.name === sourceFile.name){ out.push({file:f, score:105, reason:'name-exact'}); processed++; setProgress(p=>({done:p.done+1,total:p.total})); continue; }
        const canv = await canvasFromAnyImageFile(f);
        if(mustMatchDims && (canv.width!==srcW || canv.height!==srcH)){ skippedDims++; processed++; setProgress(p=>({done:p.done+1,total:p.total})); continue; }
        const h=aHash(prepareForHash(canv)); const dist=Number(hammingDistance(srcHash,h)); const sim=Math.round((1 - dist/64)*100);
        if(sim>=threshold) out.push({file:f, score:sim, reason:'hash'}); else below++;
      }catch(e){ errors++; setLog(l=>[...l, `⚠️ ${f?.name}: ${e?.message||e}`]); }
      processed++; setProgress(p=>({done:p.done+1,total:p.total}));
    }

    let filtered = out;
    if (sampleDestName && filterBySampleBase){
      const base = baseName(sampleDestName);
      filtered = out.filter(c => baseName(c.file.name) === base);
    }

    filtered.sort((a,b)=> b.score - a.score);
    const withUrls = await Promise.all(filtered.map(async (c)=>{
      const previewUrl = isSandbox ? await fileToDataURL(c.file) : URL.createObjectURL(c.file);
      return { ...c, previewUrl };
    }));
    setCandidates(withUrls);
    setAnalysisDone(true);
    setLog(l=>[...l, `✅ Analisados ${processed}/${total}. Candidatos: ${filtered.length}. Dimensões diferentes: ${skippedDims}. Abaixo limiar: ${below}. Erros: ${errors}.`] );
    setBusy(false);
  }

  function toggleSelect(name){
    setSelected(prev=>{ const n=new Set(prev); if(n.has(name)) n.delete(name); else n.add(name); return n; });
  }

  function selectAll(){ setSelected(new Set(candidates.map(c=>c.file.name))); }
  function clearAll(){ setSelected(new Set()); }
  function selectPrioritarios(){ setSelected(new Set(candidates.filter(c=>c.reason==='name-exact').map(c=>c.file.name))); }

  function selectByAliases(){
    const pivot = sampleDestName || sourceInfo?.name;
    if(!pivot){ setLog(l=>[...l, 'ℹ️ Para usar "Selecionar por aliases", indica uma amostra ou carrega a fonte.']); return; }
    const aliases = aliasSetFromName(pivot);
    const sel = new Set();
    for(const c of candidates){
      const b = baseName(c.file.name);
      for(const a of aliases){ if(b.includes(a)){ sel.add(c.file.name); break; } }
    }
    setSelected(sel);
    setLog(l=>[...l, `🔎 Selecionados ${sel.size} por aliases (${[...aliases].join(', ')})`]);
  }

  async function replaceSelected(){
    if(selected.size===0){ setLog(l=>[...l,'⚠️ Nenhum ficheiro selecionado.']); return; }
    const srcCanvas = await canvasFromAnyImageFile(sourceFile);
    const blob = await blobFromCanvasAsFormat(srcCanvas, 'image/png');
    let ok=0, fail=0; const replaced=[]; const failed=[]; const targetNames = new Set(candidates.map(c=>c.file.name));

    // Se o utilizador escolheu uma pasta destino e o ambiente permite FSA, gravamos lá.
    const canWrite = !!targetDir && !isSandbox; // FSA não funciona em iframe sandbox

    for(const c of candidates){
      if(!selected.has(c.file.name)) continue;
      const destName=c.file.name;
      try{
        if(canWrite){
          const fh = await targetDir.getFileHandle(destName, { create:true });
          const w = await fh.createWritable(); await w.write(blob); await w.close();
        } else if(useFSA && dirHandle){
          // modo original: escrever diretamente na pasta analisada
          const fh = await dirHandle.getFileHandle(destName, { create:false });
          const w = await fh.createWritable(); await w.write(blob); await w.close();
        } else {
          // fallback: download
          const url = URL.createObjectURL(blob);
          const a=document.createElement('a'); a.href=url; a.download=destName; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000);
        }
        ok++; replaced.push(destName);
      }catch(e){ fail++; failed.push({name:destName, error: String(e?.message||e)}); setLog(l=>[...l, `❌ ${destName}: ${e?.message||e}`]); }
    }
    const ignored = [...targetNames].filter(n=>!selected.has(n));
    const r = { replaced, failed, ignored };
    setReport(r);
    setLog(l=>[...l, `🔁 Concluído: ${ok} substituído(s), ${fail} falhado(s), ${ignored.length} ignorado(s).`]);
  }

  const exportCSV = useMemo(()=>{
    if(!report) return null;
    const rows = [
      ['estado','ficheiro','erro']
    ];
    report.replaced.forEach(n=>rows.push(['substituido', n, '']));
    report.ignored.forEach(n=>rows.push(['ignorado', n, '']));
    report.failed.forEach(f=>rows.push(['falhado', f.name, f.error]));
    const csv = rows.map(r=>r.map(x => `"${String(x).replaceAll('"','""')}"`).join(';')).join('\n');
    return () => {
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'relatorio_substituicoes.csv'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    };
  }, [report]);

  const percent = progress.total>0 ? Math.round((progress.done/progress.total)*100) : 0;

  return (
    <div className="min-h-screen w-full bg-gray-50 p-4">
      <div className="mx-auto max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Painel esquerdo */}
        <div className="md:col-span-4 space-y-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Ambiente de execução</CardTitle>
              <CardDescription>Deteção automática</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm">
              <Info className="h-4 w-4"/>
              <div>
                <div><b>Modo:</b> {runtimeEnv}</div>
                <div className="text-gray-600">{useFSA ? 'Escrita direta disponível' : 'Sem escrita direta — serão gerados downloads.'}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>1) Fonte (substituto cinzento)</CardTitle>
              <CardDescription>Carrega o PNG que queres usar como substituto. O nome final será o do destino.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Input type="file" accept="image/png,image/*" onChange={onSourceChange} />
                <Upload className="h-5 w-5" />
              </div>
              {sourceInfo && (
                <div className="text-sm text-gray-600 space-y-1">
                  <div><b>Nome:</b> {sourceInfo.name}</div>
                  <div><b>Dimensões:</b> {sourceInfo.width}×{sourceInfo.height}px</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>2) Pasta de destino (originais)</CardTitle>
              <CardDescription>Sem subpastas; apenas PNG. Mantemos dimensões iguais (ex.: 16×16).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border p-2 text-xs md:text-sm flex items-center gap-2" style={{backgroundColor: useFSA ? '#F0FFF4' : '#FFF9DB', borderColor: useFSA ? '#86efac' : '#fde68a'}}>
                <span className="font-medium">{useFSA ? 'Modo: Escrita direta (FSA ativo)' : 'Modo: Compatibilidade (downloads)'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={pickFolderFSA} size="sm" className="gap-2" disabled={!useFSA}><FolderOpen className="h-4 w-4"/> Selecionar pasta (FSA)</Button>
                <Button type="button" size="sm" variant="secondary" onClick={()=>dirInputRef.current?.click()}>Carregar pasta (compatibilidade)</Button>
                <input ref={dirInputRef} type="file" className="hidden" multiple onChange={onFolderInputChange} accept="image/png" {...{ webkitdirectory: "", directory: "" }} />
              </div>

              {/* NOVO: Pasta destino explícita para guardar os alterados */}
              <Separator />
              <div className="space-y-2">
                <Label>3) (Opcional) Selecionar <b>pasta destino</b> onde guardar os ficheiros substituídos</Label>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={pickTargetFolder} disabled={isSandbox}><FolderOpen className="h-4 w-4"/>Selecionar pasta destino</Button>
                  <span className="text-xs text-gray-600">{targetDir ? (targetDir.name || 'Pasta selecionada') : (isSandbox ? 'Indisponível no Canvas (sandbox)' : 'Nenhuma pasta selecionada')}</span>
                </div>
              </div>

              <Separator />
              <div className="space-y-2">
                <Label>Limiar de similaridade ({threshold}%)</Label>
                <div className="flex items-center gap-3">
                  <Slider value={[threshold]} min={50} max={100} step={1} onValueChange={(v)=>setThreshold(v[0])} className="flex-1" />
                  <div className="flex gap-1">{[80,85,90].map(v => (<Button key={v} size="sm" variant={threshold===v?"default":"secondary"} onClick={()=>setThreshold(v)}>{v}%</Button>))}</div>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="space-y-1">
                  <Label>Exigir mesmas dimensões</Label>
                  <div className="text-xs text-gray-600">Regra fixa</div>
                </div>
                <Switch checked readOnly />
              </div>
              <div className="flex items-center justify-between py-2 border-t pt-3">
                <div className="space-y-1">
                  <Label>Priorizar ficheiro com <b>nome idêntico</b></Label>
                  <div className="text-xs text-gray-600">Se o nome do substituto for exatamente igual ao do destino, entra como candidato prioritário.</div>
                </div>
                <Switch checked={useNameMatch} onCheckedChange={setUseNameMatch} />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>4) (Opcional) Escolher um exemplo do destino</Label>
                <select className="w-full border rounded p-2 text-sm bg-white" value={sampleDestName} onChange={(e)=>setSampleDestName(e.target.value)}>
                  <option value="">— Sem amostra —</option>
                  {folderFiles.map((f,i)=> (<option key={i} value={f.name}>{f.name}</option>))}
                </select>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-600">Filtrar resultados para a mesma base de nome da amostra (ex.: <i>sign_warning_16</i> → <i>sign_warning</i>)</div>
                  <Switch checked={filterBySampleBase} onCheckedChange={setFilterBySampleBase} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={analyse} disabled={!sourceFile || folderFiles.length===0 || busy} className="gap-2">
                  <RefreshCcw className={`h-4 w-4 ${busy? 'animate-spin': ''}`}/>
                  {busy ? `A analisar… ${progress.done}/${progress.total} (${percent}%)` : 'Analisar'}
                </Button>
                <div className="text-sm text-gray-600">{folderFiles.length} PNG carregado(s)</div>
              </div>
              {busy && (
                <div className="w-full bg-gray-200 rounded h-2 overflow-hidden"><div className="bg-blue-600 h-2" style={{width: `${percent}%`}} /></div>
              )}
              {analysisDone && (
                <div className="rounded-md border border-green-300 bg-green-50 text-green-800 text-sm px-3 py-2">Análise concluída — {candidates.length} candidato(s)</div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader><CardTitle>Registo</CardTitle><CardDescription>Mensagens de operação e estado</CardDescription></CardHeader>
            <CardContent>
              <ScrollArea className="h-48 rounded border bg-white p-2 text-sm">
                {log.map((l,i)=>(<div key={i} className="py-1 whitespace-pre-wrap">{l}</div>))}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Painel direito */}
        <div className="md:col-span-8">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <CardTitle>Resultados — Seleciona os destinos a substituir</CardTitle>
                <CardDescription>Mostramos files com alta semelhança (e opcionalmente mesma base de nome da amostra). O nome final será o do ficheiro de destino.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={selectPrioritarios}><CheckSquare className="h-4 w-4"/>Prioritários</Button>
                <Button size="sm" variant="secondary" onClick={selectAll}><CheckSquare className="h-4 w-4"/>Selecionar todos</Button>
                <Button size="sm" variant="secondary" onClick={clearAll}><Square className="h-4 w-4"/>Limpar</Button>
                <Button size="sm" variant="secondary" onClick={selectByAliases} className="gap-2"><Wand2 className="h-4 w-4"/>Selecionar por aliases</Button>
                <Button size="sm" onClick={replaceSelected} disabled={selected.size===0 || !sourceFile} className="gap-2"><Replace className="h-4 w-4"/>Substituir selecionados mantendo nomes</Button>
                <Button size="sm" variant="secondary" onClick={()=>exportCSV && exportCSV()} disabled={!exportCSV}><Save className="h-4 w-4"/>Exportar relatório CSV</Button>
              </div>
            </CardHeader>
            <CardContent>
              {candidates.length===0 ? (
                <div className="text-sm text-gray-600 flex items-center gap-2"><AlertCircle className="h-4 w-4"/>Sem resultados ainda.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {candidates.map((c,idx)=>{
                    const checked = selected.has(c.file.name);
                    return (
                      <Card key={idx} className={`border ${checked? 'ring-2 ring-blue-500':''}`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="text-base truncate" title={c.file.name}>{c.file.name}</CardTitle>
                            <input type="checkbox" checked={checked} onChange={()=>toggleSelect(c.file.name)} />
                          </div>
                          <CardDescription>{c.reason==='name-exact' ? 'Nome idêntico (prioritário)' : `Similaridade ~ ${c.score}%`}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="text-xs text-gray-600">Clique para ver grande.</div>
                          <img src={c.previewUrl} alt={c.file.name} className="w-full h-40 object-contain border rounded cursor-zoom-in" onClick={()=>setPreview({title:c.file.name, destUrl:c.previewUrl, srcUrl: sourceUrl})}/>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
            {report && (
              <CardFooter className="flex flex-col items-start gap-2 border-t pt-3">
                <div className="text-sm font-medium">Relatório</div>
                <div className="text-xs text-gray-700">Substituídos: {report.replaced.length} · Ignorados: {report.ignored.length} · Falhados: {report.failed.length}</div>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closePreview}>
          <div className="bg-white rounded-2xl shadow-xl p-4 max-w-6xl w-full" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2">
              <div className="font-medium truncate pr-4">Pré-visualização — {preview.title}</div>
              <Button size="sm" variant="secondary" onClick={closePreview}><X className="h-4 w-4 mr-1"/>Fechar</Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-600 pb-1">Destino atual</div>
                <img src={preview.destUrl} alt="dest" className="w-full h-96 object-contain border rounded" />
              </div>
              {preview.srcUrl && (
                <div>
                  <div className="text-xs text-gray-600 pb-1">Substituto (fonte)</div>
                  <img src={preview.srcUrl} alt="src" className="w-full h-96 object-contain border rounded" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
