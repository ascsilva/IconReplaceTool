// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Icon Replace Tool — Similares v31 (com pasta destino e layout do mock)
 *
 * ✅ Mantém regras e funcionalidades:
 *  - DIMENSÕES iguais (obrigatório)
 *  - Similaridade visual (aHash + bordas) + pesquisa por NOME/aliases
 *  - Evita duplicados
 *  - Substituição em massa
 *  - Exportação CSV do relatório
 *  - FSA (File System Access) para escrita direta em pasta destino + fallback para download
 *
 * 🧩 Layout alinhado ao mock (coluna esquerda com 1) Fonte, 2) Pasta de destino (originais), 3) (Opcional) Pasta destino;
 * coluna direita com Resultados, ações no topo e grelha de cartões com preview)
 */

// ===== Utils =====
async function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    try {
      if (!file || file.size === 0) return reject(new Error("Ficheiro vazio ou inválido."));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ img });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Falha ao carregar imagem '${file?.name || "(sem nome)"}'.`));
      };
      img.src = url;
    } catch (e) {
      reject(e);
    }
  });
}

function drawToCanvas(imgOrCanvas, maxSize = 2048) {
  const src = imgOrCanvas instanceof HTMLCanvasElement
    ? imgOrCanvas
    : (() => {
        const c = document.createElement("canvas");
        c.width = imgOrCanvas.width;
        c.height = imgOrCanvas.height;
        c.getContext("2d").drawImage(imgOrCanvas, 0, 0);
        return c;
      })();
  const canvas = document.createElement("canvas");
  let w = src.width,
    h = src.height;
  const scale = Math.min(maxSize / Math.max(w, h), 1);
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

function aHash(img, size = 8) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
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

function hammingDistance(a, b) {
  let x = a ^ b;
  let d = 0;
  while (x) {
    d++;
    x &= x - 1n;
  }
  return d;
}

function edgeCanvasFromCanvas(canvas) {
  const w = canvas.width,
    h = canvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const sctx = canvas.getContext("2d");
  const dctx = out.getContext("2d");
  const src = sctx.getImageData(0, 0, w, h);
  const dst = dctx.createImageData(w, h);
  const d = src.data,
    o = dst.data;
  const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const gray = new Float32Array(w * h);
  for (let y = 0, p = 0; y < h; y++)
    for (let x = 0; x < w; x++, p += 4)
      gray[y * w + x] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      let gx = 0,
        gy = 0,
        k = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++, k++) {
          const v = gray[(y + j) * w + (x + i)];
          gx += gxK[k] * v;
          gy += gyK[k] * v;
        }
      const mag = Math.min(255, Math.hypot(gx, gy));
      const idx = (y * w + x) * 4;
      o[idx] = o[idx + 1] = o[idx + 2] = mag;
      o[idx + 3] = 255;
    }
  dctx.putImageData(dst, 0, 0);
  return out;
}

function prepareForHash(canvas) {
  return edgeCanvasFromCanvas(canvas);
}
function extFromName(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
function baseName(name) {
  const dot = name.lastIndexOf(".");
  let b = dot >= 0 ? name.slice(0, dot) : name;
  return b
    .toLowerCase()
    .replace(/[-_](copy|final|novo|new)$/i, "")
    .replace(/[@_-]?\d+x$/i, "")
    .replace(/[-_]?\d+$/i, "")
    .replace(/-(filled|outline|solid|regular)$/i, "")
    .replace(/\s+/g, "");
}
async function canvasFromAnyImageFile(file) {
  if (!file || file.size === 0) throw new Error("Ficheiro vazio ou corrompido.");
  try {
    if (window.createImageBitmap) {
      const bmp = await createImageBitmap(file);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close();
      return drawToCanvas(c, 2048);
    }
  } catch (e) {}
  const { img } = await loadImageFromFile(file);
  return drawToCanvas(img, 2048);
}
async function blobFromCanvasAsFormat(canvas, mime = "image/png", quality = 0.92) {
  return new Promise((r) => canvas.toBlob((b) => r(b), mime, quality));
}

// ===== Aliases (nome normalizado) =====
const ALIAS_GROUPS = [
  ["warning", "alert", "caution", "attention", "sign_warning", "triangle_warning", "exclamation"],
  ["info", "information", "circle_info", "i"],
  ["error", "danger", "stop", "close", "x", "times", "cross"],
  ["check", "ok", "success", "tick", "done"],
  ["doc", "document", "file", "paper", "sheet"],
  ["download", "arrow_down", "saveas"],
  ["upload", "arrow_up", "import"],
  ["refresh", "reload", "sync", "rotate", "retry"],
  ["save", "disk", "floppy"],
  ["search", "magnifier", "loupe"],
  ["lock", "secure", "padlock", "locker"],
  ["user", "person", "profile", "account"],
  ["settings", "gear", "cog", "preferences"],
  ["trash", "bin", "delete", "remove"],
  ["edit", "pencil", "write"],
  [
    "arrow",
    "arrows",
    "chevron",
    "caret",
    "triangle",
    "nav",
    "next",
    "prev",
    "previous",
    "back",
    "forward",
    "expand",
    "collapse",
    "open",
    "close",
    "left",
    "right",
    "up",
    "down",
    "increase",
    "decrease",
  ],
];

function tokenizeQuery(q) {
  return String(q || "").toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}
function aliasSetFromName(n) {
  const b = baseName(n || "");
  const toks = tokenizeQuery(b);
  const set = new Set();
  for (const g of ALIAS_GROUPS) {
    if (g.some((t) => toks.some((x) => b.includes(x)))) g.forEach((x) => set.add(x));
  }
  if (set.size === 0 && b) set.add(b);
  return set;
}

export default function IconReplaceTool() {
  // Ambiente / FSA
  const [fsaAvailable, setFsaAvailable] = useState(false);
  const [isIframe, setIsIframe] = useState(false);

  // Ficheiros e análise
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [sourceInfo, setSourceInfo] = useState(null);
  const [threshold, setThreshold] = useState(90);
  const [folderFiles, setFolderFiles] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [analysisDone, setAnalysisDone] = useState(false);
  const [report, setReport] = useState(null);

  // Pesquisa por nome
  const [nameQuery, setNameQuery] = useState("");
  const [includeNameLike, setIncludeNameLike] = useState(true);
  const [sampleDestName, setSampleDestName] = useState("");
  const [filterBySampleBase, setFilterBySampleBase] = useState(true);

  // Pastas (FSA)
  const srcInputRef = useRef(null);
  const dirInputRef = useRef(null);
  const [targetDir, setTargetDir] = useState(null);
  const [targetDirLabel, setTargetDirLabel] = useState("Nenhuma pasta selecionada");

  useEffect(() => {
    const iframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();
    setIsIframe(iframe);
    setFsaAvailable(!!window.showDirectoryPicker && !iframe);
    if (iframe) setLog((l) => [...l, "ℹ️ Canvas/iFrame: FSA desativado. Usar downloads como fallback."]);
  }, []);

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error("Falha ao ler DataURL"));
      fr.readAsDataURL(file);
    });
  }

  // >>> Nome aparece imediatamente após seleção
  async function onSourceChange(e) {
    const f = e?.target?.files?.[0] || e?.files?.[0] || e?.file || null;
    setSourceFile(f || null);
    if (!f) return;
    setSourceInfo((prev) => ({ ...(prev || {}), name: f.name, width: prev?.width || 0, height: prev?.height || 0 }));
    try {
      const { img } = await loadImageFromFile(f);
      const url = await fileToDataURL(f);
      setSourceUrl(url);
      setSourceInfo({ name: f.name, width: img.width, height: img.height });
      setLog((l) => [...l, `Fonte: ${f.name} (${img.width}×${img.height}px)`]);
    } catch (err) {
      setSourceInfo({ name: f.name, width: 0, height: 0 });
      setLog((l) => [...l, `❌ Erro a ler fonte: ${err.message || err}`]);
    }
  }

  function onFolderInputChange(e) {
    const list = Array.from(e.target.files || []).filter(
      (f) => extFromName(f.name) === "png" && (f.type?.startsWith("image/") ?? true)
    );
    setFolderFiles(list);
    setLog((l) => [...l, `Carregados ${list.length} PNG (compatibilidade)`]);
  }

  async function pickTargetFolder() {
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      setTargetDir(handle);
      setTargetDirLabel(handle.name || "Pasta selecionada");
      setLog((l) => [...l, `📁 Pasta destino: ${handle.name || "(sem nome)"}`]);
    } catch (e) {
      setLog((l) => [...l, `❌ Erro a selecionar pasta destino: ${e?.message || e}`]);
    }
  }

  function uniqueByFileName(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const nm = item?.file?.name || item?.name || "";
      if (!seen.has(nm)) {
        seen.add(nm);
        out.push(item);
      }
    }
    return out;
  }

  async function analyse() {
    setReport(null);
    if (!sourceFile || folderFiles.length === 0) {
      setLog((l) => [...l, "⚠️ Fonte e pasta são obrigatórios"]);
      return;
    }
    setBusy(true);
    setCandidates([]);
    setSelected(new Set());
    setAnalysisDone(false);
    const total = folderFiles.length;
    setProgress({ done: 0, total: total });

    const srcCanvas = await canvasFromAnyImageFile(sourceFile);
    const srcW = srcCanvas.width,
      srcH = srcCanvas.height;
    const srcHash = aHash(prepareForHash(srcCanvas));

    const out = [];
    let processed = 0,
      skippedDims = 0,
      below = 0,
      errors = 0;
    for (const f of folderFiles) {
      try {
        const canv = await canvasFromAnyImageFile(f);
        if (canv.width !== srcW || canv.height !== srcH) {
          skippedDims++;
          processed++;
          setProgress((p) => ({ done: p.done + 1, total: p.total }));
          continue;
        }

        // 1) Visual
        const h = aHash(prepareForHash(canv));
        const dist = Number(hammingDistance(srcHash, h));
        const sim = Math.round((1 - dist / 64) * 100);
        if (sim >= threshold) out.push({ file: f, score: sim, reason: "hash" });

        // 2) Nome
        const tokens = new Set();
        if (includeNameLike && sourceInfo?.name) {
          aliasSetFromName(sourceInfo.name).forEach((t) => tokens.add(t));
        }
        tokenizeQuery(nameQuery).forEach((t) => tokens.add(t));
        if (tokens.size) {
          const bn = baseName(f.name);
          if ([...tokens].some((t) => bn.includes(t)))
            out.push({ file: f, score: 100, reason: nameQuery ? "name-query" : "name-like" });
        }
      } catch (e) {
        errors++;
        setLog((l) => [...l, `⚠️ ${f?.name}: ${e?.message || e}`]);
      }
      processed++;
      setProgress((p) => ({ done: p.done + 1, total: p.total }));
    }

    // Amostra + dedupe + sort
    let filtered = out;
    if (sampleDestName && filterBySampleBase) {
      const base = baseName(sampleDestName);
      filtered = out.filter((c) => baseName(c.file.name) === base);
    }
    filtered = uniqueByFileName(filtered);
    filtered.sort((a, b) => b.score - a.score || String(a.reason).localeCompare(String(b.reason)));

    const withUrls = await Promise.all(
      filtered.map(async (c) => ({ ...c, previewUrl: await fileToDataURL(c.file) }))
    );
    setCandidates(withUrls);
    setAnalysisDone(true);
    setLog((l) => [
      ...l,
      `✅ Analisados ${processed}/${total}. Candidatos: ${withUrls.length}. Dimensões diferentes: ${skippedDims}. Abaixo limiar: ${below}. Erros: ${errors}.`,
    ]);
    setBusy(false);
  }

  function toggleSelect(name) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  }

  async function replaceSelected() {
    if (selected.size === 0) {
      setLog((l) => [...l, "⚠️ Nenhum ficheiro selecionado."]);
      return;
    }
    const srcCanvas = await canvasFromAnyImageFile(sourceFile);
    const blob = await blobFromCanvasAsFormat(srcCanvas, "image/png");
    let ok = 0,
      fail = 0;
    const replaced = [];
    const failed = [];
    const targetNames = new Set(candidates.map((c) => c.file.name));

    for (const c of candidates) {
      if (!selected.has(c.file.name)) continue;
      const destName = c.file.name;
      try {
        if (fsaAvailable && targetDir) {
          const fh = await targetDir.getFileHandle(destName, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        } else {
          // fallback: download
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = destName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        ok++;
        replaced.push(destName);
      } catch (e) {
        fail++;
        failed.push({ name: destName, error: String(e?.message || e) });
        setLog((l) => [...l, `❌ ${destName}: ${e?.message || e}`]);
      }
    }
    const ignored = [...targetNames].filter((n) => !selected.has(n));
    const r = { replaced, failed, ignored };
    setReport(r);
    setLog((l) => [...l, `🔁 Concluído: ${ok} substituído(s), ${fail} falhado(s), ${ignored.length} ignorado(s).`]);
  }

  const exportCSV = useMemo(() => {
    if (!report) return null;
    const rows = [["estado", "ficheiro", "erro"]];
    report.replaced.forEach((n) => rows.push(["substituido", n, ""]))
    report.ignored.forEach((n) => rows.push(["ignorado", n, ""]))
    report.failed.forEach((f) => rows.push(["falhado", f.name, f.error]))
    const csv = rows.map((r) => r.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(";")).join("\n")
    return () => {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "relatorio_substituicoes.csv"
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }
  }, [report])

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  // Helpers do layout (toolbar de resultados)
  function selectAll() {
    setSelected(new Set(candidates.map((c) => c.file.name)));
  }
  function clearAll() {
    setSelected(new Set());
  }
  function selectAliases() {
    const names = candidates
      .filter((c) => c.reason === "name-like" || c.reason === "name-query")
      .map((c) => c.file.name);
    setSelected(new Set(names));
  }
  function prioritize() {
    setCandidates((prev) => {
      const arr = [...prev];
      arr.sort((a, b) => {
        const prioA = a.reason === "hash" ? 1 : 0; // visuais primeiro
        const prioB = b.reason === "hash" ? 1 : 0;
        return prioB - prioA || b.score - a.score;
      });
      return arr;
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", padding: 16, color: "#111827" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
          {/* Painel esquerdo */}
          <div style={{ display: "grid", gap: 16 }}>
            {/* Ambiente de execução */}
            <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Ambiente de execução</h3>
              <p style={{ margin: "6px 0", color: "#6b7280", fontSize: 13 }}>
                Deteção automática
              </p>
              <div style={{ fontSize: 12, color: "#374151" }}>
                <div>
                  <b>Modo:</b> {fsaAvailable ? "Standalone (FSA disponível)" : "Sandbox (FSA indisponível)"}
                </div>
                <div>Escrita direta {fsaAvailable ? "disponível" : "indisponível"}</div>
              </div>
            </section>

            {/* 1) Fonte */}
            <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>1) Fonte (substituto cinzento)</h3>
              <p style={{ margin: "6px 0", color: "#6b7280" }}>
                Carrega o PNG que queres usar como substituto. O nome final será o do destino.
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (!f) return;
                  if (!(f.type?.startsWith("image/") || f.name?.toLowerCase().endsWith(".png"))) {
                    setLog((l) => [...l, "⚠️ Apenas são permitidas imagens (PNG recomendado)."]);
                    return;
                  }
                  const fake = { target: { files: [f] } };
                  await onSourceChange(fake);
                }}
                style={{ border: "1px dashed #d1d5db", borderRadius: 10, padding: 10 }}
              >
                <input
                  ref={srcInputRef}
                  id="src-file"
                  type="file"
                  accept="image/png,image/*"
                  onChange={onSourceChange}
                  style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
                />
                <button
                  type="button"
                  onClick={() => srcInputRef?.current?.click()}
                  style={{ padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#111827", color: "#fff", cursor: "pointer" }}
                >
                  Escolher ficheiro
                </button>
                <div style={{ fontSize: 13, color: "#374151" }}>
                  {(sourceInfo?.name || sourceFile?.name) ?? "Não foi escolhido nenhum ficheiro"}
                </div>
              </div>
              {sourceUrl && (
                <div style={{ marginTop: 8 }}>
                  <img src={sourceUrl} alt={sourceInfo?.name || "pré-visualização"} style={{ width: 64, height: 64, objectFit: "contain", border: "1px solid #e5e7eb", borderRadius: 8 }} />
                </div>
              )}
              {sourceInfo && (
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
                  <div>
                    <b>Nome:</b> {sourceInfo.name}
                  </div>
                  <div>
                    <b>Dimensões:</b> {sourceInfo.width}×{sourceInfo.height}px
                  </div>
                </div>
              )}
            </section>

            {/* 2) Pasta de destino (originais) */}
            <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>2) Pasta de destino (originais)</h3>
              <p style={{ margin: "6px 0", color: "#6b7280" }}>Sem subpastas; apenas PNG. Mantemos dimensões iguais (ex.: 16×16).</p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <input id="dir-picker" ref={dirInputRef} type="file" multiple onChange={onFolderInputChange} accept="image/png" webkitdirectory="" directory="" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
                <button type="button" onClick={() => dirInputRef?.current?.click()} style={{ padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#111827", color: "#fff", cursor: "pointer" }}>
                  Carregar pasta
                </button>
                <div style={{ fontSize: 13, color: "#374151" }}>
                  {folderFiles.length > 0 ? `${folderFiles.length} ficheiro(s) selecionado(s)` : "Não foi escolhida nenhuma pasta"}
                </div>
              </div>

              <hr style={{ margin: "12px 0" }} />

              <div>
                <label>Limiar de similaridade ({threshold}%)</label>
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={1}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {[80, 85, 90].map((v) => (
                    <button key={v} onClick={() => setThreshold(v)} style={{ padding: "4px 8px", border: "1px solid #e5e7eb", borderRadius: 8 }}>
                      {v}%
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label>Nome(s) semelhantes</label>
                <input
                  type="text"
                  placeholder="ex.: arrow, chevron, caret"
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  style={{ width: "100%", padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                  <div style={{ fontSize: 12 }}>
                    <b>Usar aliases automáticos da fonte</b>
                    <div style={{ color: "#6b7280" }}>ex.: "arrow_left" → arrow, chevron, caret, left, right, ...</div>
                  </div>
                  <input type="checkbox" checked={includeNameLike} onChange={(e) => setIncludeNameLike(e.target.checked)} />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <label>Filtrar por amostra (opcional)</label>
                <select
                  value={sampleDestName}
                  onChange={(e) => setSampleDestName(e.target.value)}
                  style={{ width: "100%", padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}
                >
                  <option value="">— Sem amostra —</option>
                  {folderFiles.map((f, i) => (
                    <option key={i} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Restringir à mesma base de nome</div>
                  <input type="checkbox" checked={filterBySampleBase} onChange={(e) => setFilterBySampleBase(e.target.checked)} />
                </div>
              </div>

              {/* 3) (Opcional) Pasta destino para escrever substituídos */}
              <hr style={{ margin: "12px 0" }} />
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>3) (Opcional) Selecionar pasta destino</div>
                {fsaAvailable ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={pickTargetFolder} style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}>
                      Selecionar pasta destino
                    </button>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{targetDir ? targetDirLabel : "— nenhuma pasta selecionada —"}</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    FSA indisponível neste ambiente. Será feito <b>download</b> dos ficheiros com o nome de destino.
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
                <button
                  onClick={analyse}
                  disabled={!sourceFile || folderFiles.length === 0 || busy}
                  style={{ padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#111827", color: "#fff" }}
                >
                  {busy ? `A analisar… ${progress.done}/${progress.total} (${percent}%)` : "Analisar"}
                </button>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{folderFiles.length} PNG carregado(s)</div>
              </div>
              {busy && (
                <div style={{ width: "100%", background: "#e5e7eb", height: 8, borderRadius: 8, overflow: "hidden", marginTop: 8 }}>
                  <div style={{ background: "#2563eb", height: 8, width: `${percent}%` }} />
                </div>
              )}
              {analysisDone && (
                <div style={{ marginTop: 8, background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46", padding: "6px 8px", borderRadius: 8 }}>
                  Análise concluída — {candidates.length} candidato(s)
                </div>
              )}
            </section>

            {/* Registo */}
            <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Registo</h3>
              <div style={{ height: 160, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, fontSize: 12, background: "#fff" }}>
                {log.map((l, i) => (
                  <div key={i} style={{ padding: "2px 0", whiteSpace: "pre-wrap" }}>
                    {l}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Painel direito */}
          <div>
            <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Resultados — Seleciona os destinos a substituir</h3>
                  <p style={{ margin: "4px 0", color: "#6b7280", fontSize: 12 }}>
                    Mostramos ficheiros com alta semelhança (visual e/ou nome). O nome final será o do destino.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={prioritize} style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}>Prioritários</button>
                  <button onClick={selectAliases} style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}>Selecionar por aliases</button>
                  <button onClick={selectAll} style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}>Selecionar todos</button>
                  <button onClick={clearAll} style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8 }}>Limpar</button>
                  <button onClick={replaceSelected} disabled={selected.size === 0 || !sourceFile} style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#111827", color: "#fff" }}>
                    Substituir selecionados mantendo nomes
                  </button>
                  <button onClick={() => exportCSV && exportCSV()} disabled={!exportCSV} style={{ padding: "6px 10px", border: "1px dashed #e5e7eb", borderRadius: 8 }}>
                    Exportar relatório CSV
                  </button>
                </div>
              </div>

              {candidates.length === 0 ? (
                <div style={{ fontSize: 12, color: "#6b7280" }}>Sem resultados ainda.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginTop: 12 }}>
                  {candidates.map((c, idx) => {
                    const checked = selected.has(c.file.name);
                    return (
                      <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 8, boxShadow: checked ? "0 0 0 3px #3b82f6" : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div title={c.file.name} style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.file.name}
                          </div>
                          <input type="checkbox" checked={checked} onChange={() => toggleSelect(c.file.name)} />
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                          {c.reason === "name-like" || c.reason === "name-query" ? "Nome semelhante" : `Similaridade ~ ${c.score}%`}
                        </div>
                        <img src={c.previewUrl} alt={c.file.name} style={{ width: "100%", height: 160, objectFit: "contain", border: "1px solid #e5e7eb", borderRadius: 8, marginTop: 8 }} />
                      </div>
                    );
                  })}
                </div>
              )}

              {report && (
                <div style={{ marginTop: 12, borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                  <div style={{ fontWeight: 700 }}>Relatório</div>
                  <div style={{ fontSize: 12, color: "#374151" }}>
                    Substituídos: {report.replaced.length} · Ignorados: {report.ignored.length} · Falhados: {report.failed.length}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
