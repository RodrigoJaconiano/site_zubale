/* script.js — integrado: CSV/JSON fetch, cache, geoloc, parse robusto, filtros por checkbox + select,
   seleção de cards (toggle), e melhorias responsivas/UX
   Atualizado: correções para mostrar ESTADO — CIDADE e normalização/agrupamento de lojas */
const JSON_URL = "https://script.google.com/macros/s/AKfycbxIchf_yVY28y0TQxA0tc6ygi4Axcmcsg2CoW-aTMypersUjvH5u4Kp0I62Y7T5DpEg/exec";
const PUB_ID = "2PACX-1vQBDKbeXYi4xycW9bnnOoXLByemROrrE9-wW0gMS-yuKMl67PrYRN78Jy239cDsslh6iP8tgj_rV9nZ";
const CSV_URL = `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?output=csv`;
const CACHE_KEY = "agenda_allData_v1";
const CACHE_TIME_KEY = "agenda_allData_time_v1";
const CACHE_TTL_MS = 1000 * 60 * 3; // 3 min

let allData = [];
let userCoords = null;
let lastRender = { userLat: null, userLng: null };

const $ = id => document.getElementById(id);

// normalize base (lowercase, remove diacritics, remove spaces/underscores/hyphens)
// usado internamente para chaves e comparações
const normalize = s => (s ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[\s\-_]/g,"");

// remove diacríticos mas preserva espaços — útil para exibicão sem acento
function removeDiacriticsKeepSpaces(s){
  return (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function capitalizeFirst(s){
  if(!s) return "";
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}
// pega primeiro token (palavra) do nome, sem diacríticos, lowercased — usado como key de loja
function firstTokenKey(s){
  if(!s) return "";
  const first = String(s).trim().split(/\s+/)[0] || "";
  // normalize for key (remove accents, lowercase, remove non-alnum)
  return removeDiacriticsKeepSpaces(first).toLowerCase().replace(/[^\w]/g,"");
}
// display-friendly first token (sem acento, Title Case)
function firstTokenLabel(s){
  if(!s) return "";
  const first = String(s).trim().split(/\s+/)[0] || "";
  const noAccent = removeDiacriticsKeepSpaces(first).replace(/[^\w\s]/g,"");
  return capitalizeFirst(noAccent);
}

/* ---------- UTIL: formatar distância em pt-BR ---------- */
function formatDistanceBr(km){
  if (!isFinite(km)) return "";
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(km);
}

/* Haversine */
function distanceKm(lat1, lon1, lat2, lon2){
  if (![lat1,lon1,lat2,lon2].every(v => isFinite(Number(v)))) return NaN;
  lat1 = Number(lat1); lon1 = Number(lon1); lat2 = Number(lat2); lon2 = Number(lon2);
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI/180;
  const dLon = (lon2 - lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDateBr(d){
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const dd = d.getDate().toString().padStart(2,'0');
  const mm = (d.getMonth()+1).toString().padStart(2,'0');
  const yy = d.getFullYear().toString().slice(-2);
  return `${dd}/${mm}/${yy}`;
}

/* imagem lookup */
const lojaImagesMap = {
  atc: "images/Foto Atacadão.png",
  sams: "images/Foto Sams.png",
  crfo: "images/Foto Carrefour.png",
  atk: "images/Foto Atakarejo.png",
  coop: "images/Foto COOP.png",
  gbarbosa: "images/Foto GBarbosa.png",
  amg: "images/Foto Amigão.png",
  prz: "images/Foto Prezunic.png",
  mer: "images/Foto Mercantil.png",
  dlt: "images/Foto Delta.png",
  slg: "images/Foto SuperLagoa.png",
  rol: "images/Foto Roldão.png",
  paguemenosbr: "images/Foto PagueMenosBR.png",
  boa: "images/Foto BOA Supermercados.png",
  "99": "images/Foto 99.png",
  asi: "images/Foto AssaiAtacadista.png",
  barbosa: "images/Foto barbosa.png",
  sonda: "images/Foto Sonda.png",

};
function getLojaImage(nome){
  const ln = normalize(nome||"");
  for (const k in lojaImagesMap) if (ln.includes(k)) return lojaImagesMap[k];
  return "images/default.jpg";
}

/* ---------- CSV parser (mantém células originais em __cells) ---------- */
function csvToObjects(csvText){
  const rows = [];
  let cur = "";
  let row = [];
  let inQuotes = false;
  for (let i=0;i<csvText.length;i++){
    const ch = csvText[i];
    if (ch === '"'){
      if (inQuotes && csvText[i+1] === '"'){ cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes){
      row.push(cur); cur = "";
    } else if ((ch === '\n' || ch === '\r') && !inQuotes){
      if (ch === '\r' && csvText[i+1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length){
    row.push(cur); rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim());
  return rows.map(r => {
    const obj = {};
    for (let i=0;i<headers.length;i++) obj[headers[i]] = (r[i] ?? "").trim();
    obj.__cells = r.map(c => (c ?? "").toString().trim());
    return obj;
  });
}

/* fetch helpers */
async function fetchJsonEndpoint(){
  const res = await fetch(JSON_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("JSON endpoint returned " + res.status);
  return await res.json();
}
async function fetchCsvFallback(){
  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("CSV fetch failed " + res.status);
  const txt = await res.text();
  if (/^\s*<!doctype html/i.test(txt) || /<html[\s>]/i.test(txt)) {
    throw new Error("CSV endpoint returned HTML (provavelmente a planilha não está publicada publicamente).");
  }
  return csvToObjects(txt);
}

/**
 * findField robusto:
 * - mapeia as chaves do objeto para lowercase para permitir variações de capitalização
 * - busca pelas chaves passadas (também lowercase)
 */
function findField(obj, keys){
  if (!obj || typeof obj !== "object") return undefined;
  const keyMap = {};
  for (const k of Object.keys(obj)) { keyMap[k.trim().toLowerCase()] = k; }
  for (const k of keys) {
    const lk = String(k).trim().toLowerCase();
    if (keyMap[lk] && obj[keyMap[lk]] !== undefined) return obj[keyMap[lk]];
  }
  return undefined;
}

/* ---------- robust coordinate parsing helpers ---------- */
function parseCoordinate(raw){
  if (raw === undefined || raw === null) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;
  const m = s.match(/-?\d+[.,]?\d*/);
  if (!m) return NaN;
  const v = parseFloat(m[0].replace(',', '.'));
  return isFinite(v) ? v : NaN;
}
function extractLatLngFromRow(rowObj){
  const latKeys = ["Latitude","LAT","Lat","latitude","lat","LATITUDE"];
  const lngKeys = ["Longitude","LNG","Long","LONG","longitude","long","LONGITUDE","Lng","LON","Lon"];
  let lat = NaN, lng = NaN;
  const latRaw = findField(rowObj, latKeys);
  const lngRaw = findField(rowObj, lngKeys);
  if (latRaw !== undefined) lat = parseCoordinate(latRaw);
  if (lngRaw !== undefined) lng = parseCoordinate(lngRaw);
  if (!isFinite(lat) && Array.isArray(rowObj.__cells) && rowObj.__cells.length > 7) lat = parseCoordinate(rowObj.__cells[7]);
  if (!isFinite(lng) && Array.isArray(rowObj.__cells) && rowObj.__cells.length > 8) lng = parseCoordinate(rowObj.__cells[8]);
  if (!isFinite(lat) || !isFinite(lng)){
    const joined = (Array.isArray(rowObj.__cells) ? rowObj.__cells.join(" ") : Object.values(rowObj).join(" "));
    const matches = joined.match(/-?\d+[.,]?\d*/g);
    if (matches && matches.length >= 2){
      if (!isFinite(lat)) lat = parseFloat(matches[matches.length-2].replace(',', '.'));
      if (!isFinite(lng)) lng = parseFloat(matches[matches.length-1].replace(',', '.'));
    }
  }
  if (!isFinite(lat)) lat = NaN;
  if (!isFinite(lng)) lng = NaN;
  return { lat, lng };
}

/* parseDatePreferDDMM */
function parseDatePreferDDMM(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const isoMatch = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const dt = new Date(y, m - 1, d);
    dt.setHours(0,0,0,0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const parts = s.split(/[\/\-\.\s]/).filter(Boolean);
  if (parts.length >= 2) {
    let [p1,p2,p3] = parts.map(p => p.replace(/\D/g,""));
    const d = parseInt(p1,10);
    const m = parseInt(p2,10);
    let y = p3 ? parseInt(p3,10) : new Date().getFullYear();
    if (y < 100) y += 2000;
    if (y < 1900) y = new Date().getFullYear();
    const dt = new Date(y, m-1, d);
    dt.setHours(0,0,0,0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  dt.setHours(0,0,0,0);
  return isNaN(dt.getTime()) ? null : dt;
}

/* ---------- carregar dados e ordenar por data, removendo >4 dias passados ---------- */
async function loadAndPrepareData(forceReload=false){
  // tentativa segura de carregar do cache
  try {
    if (!forceReload) {
      const rawCache = localStorage.getItem(CACHE_KEY);
      const time = parseInt(localStorage.getItem(CACHE_TIME_KEY) || "0",10);
      if (rawCache && (Date.now() - time) < CACHE_TTL_MS) {
        try {
          const parsed = JSON.parse(rawCache);
          if (Array.isArray(parsed) && parsed.length) {
            allData = parsed;
            console.log("Dados carregados do cache:", allData.length);
            return;
          }
        } catch (e) { console.warn("Falha ao ler cache, limpando...", e); localStorage.removeItem(CACHE_KEY); localStorage.removeItem(CACHE_TIME_KEY); }
      }
    }
  } catch(e){ console.warn("Erro acessando cache localStorage:", e); }

  // buscar CSV público (fallback)
  let raw = [];
  try {
    raw = await fetchCsvFallback();
    console.log("CSV fetch OK, linhas:", raw.length);
  } catch(errCsv){
    console.error("CSV fetch failed", errCsv);
    setFeedback("Erro ao buscar CSV: " + (errCsv && errCsv.message ? errCsv.message : "ver console"));
    raw = [];
  }

  const mapped = raw.map(row=>{
    const nome = findField(row, ["Nome da Loja","Loja","Nome","nome","Loja Nome"]) || findField(row, ["A"]) || (row.__cells && row.__cells[0]) || "";
    const diaRaw = findField(row, ["Dia do treinamento","Dia","Data","Data do treinamento"]) || (row.__cells && row.__cells[1]) || "";
    const turno = findField(row, ["Turno","turno"]) || (row.__cells && row.__cells[2]) || "";
    const link = findField(row, ["Link SquareSpace","Link"]) || (row.__cells && row.__cells[3]) || "";
    const imgOk = findField(row, ["Imagem Preenchida corretamente?","Imagem"]) || (row.__cells && row.__cells[5]) || "";
    // CORREÇÃO CRÍTICA: coluna J (index 9) = ESTADO; coluna K (index 10) = CIDADE
    const estado = row.__cells?.[9] ?? "";
    const cidade = row.__cells?.[10] ?? "";
    const { lat, lng } = extractLatLngFromRow(row);
    const dateObj = parseDatePreferDDMM(diaRaw);
    const nomeStr = String(nome).trim();
    return {
      raw: row,
      nome: nomeStr,
      turno,
      link,
      imgOk,
      lat: isFinite(lat) ? Number(lat) : NaN,
      lng: isFinite(lng) ? Number(lng) : NaN,
      dateObj,
      estado: String(estado).trim(),
      cidade: String(cidade).trim(),
      lojaKey: firstTokenKey(nomeStr) // chave simplificada para agrupar lojas
    };
  });

  const today = new Date(); today.setHours(0,0,0,0);
  const cutoff = new Date(today); cutoff.setDate(today.getDate() - 4);

  allData = mapped
    .filter(r => r.nome && r.dateObj instanceof Date && !isNaN(r.dateObj.getTime()))
    .filter(r => r.dateObj >= cutoff)
    .map(r => ({...r, lojaNorm: normalize(r.nome)}))
    .sort((a,b)=>{
      const todaySort = new Date(); todaySort.setHours(0,0,0,0);
      const aPast = a.dateObj < todaySort;
      const bPast = b.dateObj < todaySort;
      if (aPast !== bPast) return aPast ? 1 : -1; // eventos passados vão pro final
      return a.dateObj - b.dateObj; // mantém ordenação cronológica
    });

  try { localStorage.setItem(CACHE_KEY, JSON.stringify(allData)); localStorage.setItem(CACHE_TIME_KEY, Date.now().toString()); } catch(e){ console.warn("cache write failed", e); }
}

/* UI helpers */
function setFeedback(msg){
  const f = $("feedback");
  if (f) f.textContent = msg;
}

// ----- Segurança: handler central para mudanças de filtro -----
function handleFilterChange() {
  try {
    renderCards();
  } catch (err) {
    console.warn("handleFilterChange erro:", err);
  }
}

/* FILTER UI (painel com 3 grupos: lojas, estados, cidades) */
function ensureLabelFor(element, text){
  if (!element || !element.id) return null;
  const prev = element.previousElementSibling;
  if (prev && prev.classList && prev.classList.contains("filter-label")) {
    prev.textContent = text;
    return prev;
  }
  const label = document.createElement("label");
  label.className = "filter-label";
  label.htmlFor = element.id;
  label.style.marginRight = "4px";
  label.style.fontWeight = "600";
  label.textContent = text;
  element.parentNode.insertBefore(label, element);
  return label;
}

function createCheckbox(id, value, labelText, name){
  const wrapper = document.createElement("div");
  wrapper.className = "chk";
  wrapper.style.width = "100%";
  wrapper.style.boxSizing = "border-box";
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "flex-start";
  wrapper.style.gap = "8px";
  wrapper.style.padding = "6px 10px";
  wrapper.style.borderRadius = "6px";
  wrapper.style.cursor = "pointer";
  wrapper.style.minWidth = "0";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.value = value; // valor usado internamente como key (já normalizado quando necessário)
  input.name = name;
  input.className = "filter-checkbox";
  input.style.flex = "0 0 auto";
  input.style.margin = "0";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;

  label.style.display = "block";
  label.style.flex = "1 1 auto";
  label.style.whiteSpace = "normal";
  label.style.wordBreak = "normal";
  label.style.overflowWrap = "break-word";
  label.style.hyphens = "none";
  label.style.lineHeight = "1.2";
  label.style.margin = "0";

  wrapper.appendChild(input);
  wrapper.appendChild(label);
  
  wrapper.addEventListener("click", (e) => {
    e.stopPropagation(); 
    if (e.target === input) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  return { wrapper, input, label };
}

function populateFilter(){
  const sel = $("lojaFilter");
  const chkContainer = $("checkboxFilters");
  if(!chkContainer) return;

  if (sel) sel.style.display = "none";
  let cidadeSel = $("cidadeFilter"); if (cidadeSel) cidadeSel.style.display = "none";
  let estadoSel = $("estadoFilter"); if (estadoSel) estadoSel.style.display = "none";

  // limpar e preparar container
  chkContainer.innerHTML = "";
  chkContainer.classList.add("filters-panel");
  chkContainer.setAttribute("aria-hidden", "true");
  chkContainer.classList.add("checkbox-filters"); 
  chkContainer.style.overflow = "visible";
  chkContainer.style.transition = "max-height .25s ease";
  chkContainer.style.maxHeight = "0";

  const header = document.createElement("div");
  header.className = "filters-header";
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "8px";
  const hw = document.createElement("div");
  hw.textContent = "";
  hw.style.fontWeight = "700";
  header.appendChild(hw);
  chkContainer.appendChild(header);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "";
  clearBtn.className = "btn-clear-filters";
  clearBtn.style.cursor = "pointer";
  clearBtn.classList.add('btn-clear-filters--invisible');
  clearBtn.setAttribute('aria-hidden', 'true');
  clearBtn.tabIndex = -1;
  clearBtn.disabled = true;
  clearBtn.addEventListener("click", ()=>{
    chkContainer.querySelectorAll("input[type=checkbox]").forEach(i=>i.checked=false);
    if (sel) sel.value = "Todas";
    if (estadoSel) estadoSel.value = "Todas";
    if (cidadeSel) cidadeSel.value = "Todas";
    handleFilterChange();
  });

  const groupsWrap = document.createElement("div");
  groupsWrap.className = "filters-groups";
  groupsWrap.style.display = "flex";
  groupsWrap.style.gap = "18px";
  groupsWrap.style.flexWrap = "nowrap";
  groupsWrap.style.width = "100%";
  groupsWrap.style.alignItems = "flex-start";

  function makeGroup(title, id){
    const col = document.createElement("div");
    col.className = "filter-group";
    col.style.flex = "1 1 0";
    col.style.minWidth = "0"; 
    col.style.boxSizing = "border-box";
    col.style.display = "flex";
    col.style.flexDirection = "column";
    col.style.gap = "8px";

    const t = document.createElement("div");
    t.textContent = title;
    t.style.fontWeight = "700";
    t.style.marginBottom = "6px";
    col.appendChild(t);

    const list = document.createElement("div");
    list.id = id;
    list.className = "filters-list";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.width = "100%";
    list.style.minWidth = "0";
    list.style.maxHeight = "calc(var(--filter-item-height,36px) * 10)";
    list.style.overflowY = "auto";
    list.style.WebkitOverflowScrolling = "touch";
    list.style.padding = "8px";
    list.style.border = "1px solid rgba(0,0,0,0.06)";
    list.style.borderRadius = "8px";
    list.style.boxSizing = "border-box";

    col.appendChild(list);
    return { col, list };
  }

  // ORDEM CORRIGIDA: Lojas | Estados | Cidades
  const lojasGroup = makeGroup("Redes","lojasFiltersContainer");
  const estadosGroup = makeGroup("Cidades","estadosFiltersContainer");
  const cidadesGroup = makeGroup("Estados","cidadesFiltersContainer");

  groupsWrap.appendChild(lojasGroup.col);
  groupsWrap.appendChild(estadosGroup.col);
  groupsWrap.appendChild(cidadesGroup.col);

  chkContainer.appendChild(groupsWrap);

  // --- construir mapas normalizados para remover duplicatas por case/acento ---
  const lojaMap = new Map(); // key -> label
  const stateMap = new Map(); // normalize(state) -> first observed display state
  const cityMap = new Map(); // normalize(city) -> first observed display city

  for (const d of allData){
    // lojas: chave simplificada (primeira palavra sem acento)
    const key = d.lojaKey || firstTokenKey(d.nome || "");
    if (key && !lojaMap.has(key)){
      lojaMap.set(key, firstTokenLabel(d.nome || ""));
    }
    // estados
    const s = String(d.estado || "").trim();
    const sKey = normalize(s);
    if (s && !stateMap.has(sKey)) stateMap.set(sKey, s);
    // cidades
    const c = String(d.cidade || "").trim();
    const cKey = normalize(c);
    if (c && !cityMap.has(cKey)) cityMap.set(cKey, c);
  }

  // ordenar por label (pt-BR) antes de criar checkboxes
  const lojaEntries = Array.from(lojaMap.entries()).sort((a,b)=> a[1].localeCompare(b[1],'pt-BR'));
  const stateEntries = Array.from(stateMap.entries()).map(([k,v])=>[k,v]).sort((a,b)=> a[1].localeCompare(b[1],'pt-BR'));
  const cityEntries = Array.from(cityMap.entries()).map(([k,v])=>[k,v]).sort((a,b)=> a[1].localeCompare(b[1],'pt-BR'));

  // criar checkboxes de lojas (value = key)
  for (const [key,labelText] of lojaEntries){
    const id = "chk_loja_" + key.replace(/\W/g,"_");
    const { wrapper, input } = createCheckbox(id, key, labelText, "loja"); // value é a key
    lojasGroup.list.appendChild(wrapper);
    input.addEventListener("change", handleFilterChange);
  }

  // criar checkboxes de estados (value = normalized key)
  for (const [k,display] of stateEntries){
    const id = "chk_estado_" + k.replace(/\W/g,"_");
    const { wrapper, input } = createCheckbox(id, k, display, "estado"); // value é normalized key
    estadosGroup.list.appendChild(wrapper);
    input.addEventListener("change", handleFilterChange);
  }

  // criar checkboxes de cidades (value = normalized key)
  for (const [k,display] of cityEntries){
    const id = "chk_cidade_" + k.replace(/\W/g,"_");
    const { wrapper, input } = createCheckbox(id, k, display, "cidade"); // value é normalized key
    cidadesGroup.list.appendChild(wrapper);
    input.addEventListener("change", handleFilterChange);
  }

  const toggle = $("filtersToggle");
  if (toggle){
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", (e)=>{
      e.preventDefault();
      const isOpen = chkContainer.classList.toggle("open");
      chkContainer.setAttribute("aria-hidden", (!isOpen).toString());
      if (isOpen) {
        chkContainer.style.maxHeight = "1200px";
        toggle.setAttribute("aria-expanded","true");
      } else {
        chkContainer.style.maxHeight = "0";
        toggle.setAttribute("aria-expanded","false");
      }
    });
  } else {
    chkContainer.classList.add("open");
    chkContainer.setAttribute("aria-hidden","false");
    chkContainer.style.maxHeight = "1200px";
  }

  const controlsEl = document.querySelector('.controls');
  if (controlsEl) {
    const existing = controlsEl.querySelector('.btn-clear-filters');
    if (existing) existing.remove();
    controlsEl.appendChild(clearBtn);
  } else {
    if (chkContainer.parentNode) {
      const existing = chkContainer.parentNode.querySelector('.btn-clear-filters');
      if (existing) existing.remove();
      chkContainer.parentNode.insertBefore(clearBtn, chkContainer.nextSibling);
    }
  }
}

function closeFilterPanelIfOpen(){
  const toggle=$("filtersToggle");
  const panel=$("checkboxFilters");
  if(!panel) return;
  if(!toggle) return;
  if(panel.classList.contains("open")){
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden","true");
    panel.style.maxHeight = "0";
    toggle.setAttribute("aria-expanded","false");
  }
}

/* renderCards */
function renderCards(userLat = undefined, userLng = undefined) {
  if (userLat !== undefined && userLng !== undefined && isFinite(Number(userLat)) && isFinite(Number(userLng))) {
    userCoords = { lat: Number(userLat), lon: Number(userLng) };
  }

  const container = $("container");
  if (!container) {
    console.warn("renderCards: elemento #container não encontrado no DOM.");
    setFeedback("Erro: elemento visual (#container) não encontrado. Verifique se o HTML tem o contêiner.");
    return;
  }
  container.innerHTML = "";

  // refs
  const sel = $("lojaFilter"); // legacy
  const chkContainer = $("checkboxFilters");
  const lojasContainer = document.getElementById("lojasFiltersContainer");
  const estadosContainer = document.getElementById("estadosFiltersContainer");
  const cidadesContainer = document.getElementById("cidadesFiltersContainer");

  // pegar seleções (valores são as KEYS normalizadas que setamos na populateFilter)
  let checkedLojas = [];
  if (lojasContainer) checkedLojas = Array.from(lojasContainer.querySelectorAll("input[type=checkbox]:checked")).map(i => i.value);
  const fallbackSelValue = sel ? (sel.value ?? "Todas") : "Todas";
  let checkedEstados = [];
  if (estadosContainer) checkedEstados = Array.from(estadosContainer.querySelectorAll("input[type=checkbox]:checked")).map(i => i.value);
  let checkedCidades = [];
  if (cidadesContainer) checkedCidades = Array.from(cidadesContainer.querySelectorAll("input[type=checkbox]:checked")).map(i => i.value);
  const filterValue = (checkedLojas.length ? null : (fallbackSelValue ?? "Todas"));
  const estadoHasAny = checkedEstados.length > 0;
  const cidadeHasAny = checkedCidades.length > 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let ordered = allData.slice();

  // FILTRO LOJA (comparar com lojaKey)
  if (checkedLojas.length) {
    const set = new Set(checkedLojas); // values already keys
    ordered = ordered.filter(d => set.has(d.lojaKey));
  } else if (filterValue && filterValue !== "Todas") {
    // legacy: if select used, comparar pelo nome completo (normalizado)
    ordered = ordered.filter(d => normalize(d.nome) === normalize(filterValue));
  }

  // FILTRO ESTADO (values são normalized keys)
  if (estadoHasAny) {
    const setE = new Set(checkedEstados.map(s => String(s)));
    ordered = ordered.filter(d => setE.has(normalize(d.estado || "")));
  }

  // FILTRO CIDADE (values são normalized keys)
  if (cidadeHasAny) {
    const setC = new Set(checkedCidades.map(s => String(s)));
    ordered = ordered.filter(d => setC.has(normalize(d.cidade || "")));
  }

  if (!ordered.length) {
    setFeedback("Nenhum treinamento encontrado.");
    return;
  } else setFeedback("");

  // ordenação por distância (se userCoords definido)
  const hasActiveLocation = userCoords && isFinite(userCoords.lat) && isFinite(userCoords.lon);

  if (hasActiveLocation) {
    const future = ordered.filter(d => d.dateObj instanceof Date && !isNaN(d.dateObj.getTime()) && d.dateObj >= today);
    const past = ordered.filter(d => !(d.dateObj instanceof Date && !isNaN(d.dateObj.getTime()) && d.dateObj >= today));
    const futureWithDist = future.map(d => {
      const hasCoords = isFinite(d.lat) && isFinite(d.lng);
      const dist = hasCoords ? distanceKm(userCoords.lat, userCoords.lon, d.lat, d.lng) : Infinity;
      return { ...d, __dist: (isFinite(dist) ? Number(dist) : Infinity), __hasCoords: hasCoords };
    }).sort((a, b) => { return (a.__dist || Infinity) - (b.__dist || Infinity); });
    const pastMapped = past.map(d => ({ ...d, __dist: null, __hasCoords: isFinite(d.lat) && isFinite(d.lng) }));
    ordered = futureWithDist.concat(pastMapped);
  } else {
    ordered = ordered.map(d => ({ ...d, __dist: null, __hasCoords: isFinite(d.lat) && isFinite(d.lng) }));
  }

  const frag = document.createDocumentFragment();
  for (const d of ordered) {
    const pastDays = (d.dateObj instanceof Date && !isNaN(d.dateObj.getTime())) ? Math.floor((today - d.dateObj) / (1000 * 60 * 60 * 24)) : 0;
    const isPast = d.dateObj instanceof Date ? d.dateObj < today : false;
    const isRecentPast = isPast && pastDays <= 3;
    const card = document.createElement("article");
    card.className = "card" + (isRecentPast ? " past" : "");
    card.setAttribute("tabindex", "0");
    // dataset.loja agora guarda a chave simplificada
    card.dataset.loja = d.lojaKey || normalize(d.nome);
    if (d.link) {
      card.style.cursor = "pointer";
      card.addEventListener("click", ev => {
        if (ev.target.tagName.toLowerCase() === "a" || ev.target.tagName.toLowerCase() === "button") return;
        window.open(d.link, "_blank", "noopener");
      });
      card.addEventListener("keydown", ev => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); window.open(d.link, "_blank", "noopener"); }
      });
    }

    const img = document.createElement("img");
    img.alt = d.nome;
    img.src = getLojaImage(d.nome);
    img.onerror = () => img.src = "images/default.jpg";
    card.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("div");
    title.className = "card-title";
    const nameNode = document.createElement("span");
    nameNode.textContent = d.nome;
    title.appendChild(nameNode);

    if (hasActiveLocation && d.__hasCoords && isFinite(d.__dist)) {
      const strong = document.createElement("strong");
      strong.style.marginLeft = "8px";
      strong.style.fontWeight = "700";
      strong.style.color = "var(--primary)";
      strong.textContent = `- à ${formatDistanceBr(d.__dist)} km`;
      title.appendChild(strong);
    }

    body.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "card-sub";
    let dateStr = "";
    if (d.dateObj instanceof Date && !isNaN(d.dateObj.getTime())) { dateStr = formatDateBr(d.dateObj); } else if (d.raw) {
      const diaRaw = findField(d.raw, ["Dia do treinamento", "Dia", "Data", "Data do treinamento"]) || (d.raw.__cells && d.raw.__cells[1]) || "";
      const dtFallback = parseDatePreferDDMM(diaRaw);
      if (dtFallback) dateStr = formatDateBr(dtFallback);
    }
    sub.textContent = `${dateStr} | ${d.turno || ""}`;
    body.appendChild(sub);

    if (hasActiveLocation && d.__hasCoords && isFinite(d.__dist)) {
      const dd = document.createElement("div");
      dd.className = "card-distance";
      dd.textContent = `📍 ${formatDistanceBr(d.__dist)} km de você`;
      body.appendChild(dd);
    }

    // META: ordem ESTADO — CIDADE (CORRIGIDO)
    const meta = document.createElement("div");
    meta.className = "card-meta";
    const partes = [];
    if (d.estado) partes.push(d.estado);
    if (d.cidade) partes.push(d.cidade);
    if (partes.length) meta.textContent = partes.join(" — ");
    if (meta.textContent) body.appendChild(meta);

    card.appendChild(body);
    frag.appendChild(card);
  }
  container.appendChild(frag);
}

/* ---------- GEO HELPERS ---------- */
function getCurrentPositionPromise(options={},timeoutMs=null){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){ const e=new Error("Geolocation API não suportada"); e.code=0; return reject(e); }
    let timer=null;
    const onSuccess=pos=>{ if(timer) clearTimeout(timer); resolve(pos); };
    const onError=err=>{ if(timer) clearTimeout(timer); reject(err); };
    try { navigator.geolocation.getCurrentPosition(onSuccess,onError,options); } catch(ex){ return reject(ex); }
    if(timeoutMs && timeoutMs>0){ timer=setTimeout(()=>{ const e=new Error("Timeout externo"); e.code=3; reject(e); }, timeoutMs); }
  });
}
async function obtainPositionStrategy(){
  try{
    const pos = await getCurrentPositionPromise({enableHighAccuracy:false,timeout:5000,maximumAge:300000},7000);
    return {lat: Number(pos.coords.latitude), lon: Number(pos.coords.longitude)};
  } catch(errQuick){}
  try{
    const pos = await getCurrentPositionPromise({enableHighAccuracy:true,timeout:15000,maximumAge:0},18000);
    return {lat: Number(pos.coords.latitude), lon: Number(pos.coords.longitude)};
  } catch(errHigh){ throw errHigh; }
}
async function fetchIpFallback(){
  try{
    setFeedback("Tentando localização por IP (fallback)...");
    const res=await fetch("https://ipapi.co/json/");
    if(!res.ok) return null;
    const json=await res.json();
    if(json && json.latitude && json.longitude) return {lat:parseFloat(json.latitude), lon:parseFloat(json.longitude)};
  } catch(e){}
  return null;
}

/* ---------- Helpers novos MINIMOS (mantêm nomes existentes) ---------- */
// Calcula e anexa __dist em allData (in-place). Garante que itens sem coords recebam Infinity.
function computeDistancesForAllData(lat, lon){
  const today = new Date(); today.setHours(0,0,0,0);
  if(!Array.isArray(allData)) return;
  for(const d of allData){
    try{
      if(d && d.dateObj instanceof Date && !isNaN(d.dateObj.getTime()) && d.dateObj >= today && isFinite(d.lat) && isFinite(d.lng)){
        d.__dist = distanceKm(lat, lon, d.lat, d.lng);
      } else {
        d.__dist = Infinity;
      }
    } catch(e){
      d.__dist = Infinity;
    }
  }
}
// Reordena os elementos DOM dentro do #container com base em allData.__dist.
// Usa dataset.loja em cada card para relacionar com a entrada de allData.
// Se não encontrar correspondência, deixa no final.
function reorderDomCardsByAllDataDist(){
  const container = $("container");
  if(!container) return;
  const cards = Array.from(container.querySelectorAll(".card"));
  if(!cards.length) return;

  // mapa lojaKey -> dist
  const distMap = new Map();
  for(const d of allData){
    const key = (d.lojaKey || d.loja || d.name || d.nome || "").toString();
    distMap.set(key, (isFinite(d.__dist) ? d.__dist : Infinity));
  }

  // comparator- get distance by card dataset.loja or fallback Infinity
  cards.sort((a,b)=>{
    const ka = (a.dataset.loja || a.getAttribute("data-loja") || "").toString();
    const kb = (b.dataset.loja || b.getAttribute("data-loja") || "").toString();
    const da = distMap.has(ka) ? distMap.get(ka) : parseFloat(a.dataset.distance || Infinity);
    const db = distMap.has(kb) ? distMap.get(kb) : parseFloat(b.dataset.distance || Infinity);
    return (isFinite(da) ? da : Infinity) - (isFinite(db) ? db : Infinity);
  });

  // reappend in sorted order
  for(const c of cards){
    container.appendChild(c);
  }
}
// Atualiza texto/atributo de distância dentro de cada card após cálculo (vários seletores)
function updateCardDistancesFromAllData(lat, lon){
  const container = $("container");
  if(!container) return;
  const cards = container.querySelectorAll(".card");
  for(const c of cards){
    // find card's loja key
    const lojaKey = (c.dataset.loja || c.getAttribute("data-loja") || "").toString();
    // find corresponding allData item
    let match = null;
    if(lojaKey){
      match = allData.find(d => ((d.lojaKey||d.loja||d.nome||d.name||"")+"") === lojaKey);
    }
    // fallback: try to read lat/lng from the card attributes
    let cardLat = NaN, cardLon = NaN;
    if(match && isFinite(match.__dist)){
      // use match.__dist directly
      const dist = match.__dist;
      writeDistanceToCard(c, dist);
      c.dataset.distance = String(dist);
      continue;
    } else {
      // attempt to read coords from dataset/attrs
      cardLat = parseFloat(c.dataset.lat ?? c.getAttribute("data-lat") ?? c.getAttribute("data-latitude"));
      cardLon = parseFloat(c.dataset.lng ?? c.getAttribute("data-lng") ?? c.getAttribute("data-longitude") ?? c.getAttribute("data-lon"));
      if(isFinite(cardLat) && isFinite(cardLon)){
        const dist = distanceKm(lat, lon, cardLat, cardLon);
        writeDistanceToCard(c, dist);
        c.dataset.distance = String(dist);
        continue;
      }
    }
    // if nothing, set attribute to Infinity so it goes to the bottom
    c.dataset.distance = String(Infinity);
  }
}
// util: escreve string formatada da distância no card procurando elementos comuns
function writeDistanceToCard(cardEl, dist){
  const formatted = (typeof formatDistanceBr === "function") ? formatDistanceBr(dist) : (Math.round(dist*10)/10) + " km";
  const distEl = cardEl.querySelector(".distance, .card-distance, .dist, [data-distance]");
  if(distEl){
    try { distEl.textContent = formatted; } catch(e){ cardEl.setAttribute("data-distance", String(dist)); }
  } else {
    // tenta inserir no topo como fallback (não quebra layout se não for necessário)
    try {
      const meta = cardEl.querySelector(".meta") || cardEl;
      const span = document.createElement("span");
      span.className = "card-distance auto-inserted";
      span.textContent = formatted;
      meta.appendChild(span);
    } catch(e){
      // ignore
    }
  }
}

/* ---------- meLocalize corrigido (agora 100% determinístico: calcular -> ordenar -> render -> reorder/update) ---------- */
let meLocalizeRunning = false;
async function meLocalize(){
  if(meLocalizeRunning) return;
  meLocalizeRunning = true;
  const btn = $("btnLocalize");
  if(btn) btn.disabled = true;
  try {
    if(!navigator.geolocation){ setFeedback("Navegador não suporta Geolocation."); return; }
    if(navigator.permissions && navigator.permissions.query){
      try { const p = await navigator.permissions.query({name:"geolocation"}); if(p.state === "denied"){ setFeedback("Permissão de localização negada — habilite nas configurações do site."); return; } } catch(e){}
    }
    if (!Array.isArray(allData) || allData.length === 0){ setFeedback("Aguardando carregamento dos dados..."); await loadAndPrepareData(true); populateFilter(); }
    setFeedback("Obtendo sua localização…");
    let coords;
    try { coords = await obtainPositionStrategy(); } catch(err){ throw err; }

    // define coords globais
    userCoords = { lat: Number(coords.lat), lon: Number(coords.lon) };

    // 1) Calcular distâncias para ALLDATA (in-place)
    computeDistancesForAllData(userCoords.lat, userCoords.lon);

    // 2) Ordenar allData por distância (itens sem coords vão pro fim)
    try{
      allData.sort((a,b)=>{
        const da = (isFinite(a.__dist) ? a.__dist : Infinity);
        const db = (isFinite(b.__dist) ? b.__dist : Infinity);
        return da - db;
      });
    } catch(e){
      console.warn("Erro ao ordenar allData:", e);
    }

    // 3) Reset filtros antes do render (como você já fazia)
    const sel=$("lojaFilter");
    const chkContainer=$("checkboxFilters");
    const estadoSel=$("estadoFilter");
    const cidadeSel=$("cidadeFilter");
    if(chkContainer) chkContainer.querySelectorAll("input[type=checkbox]").forEach(i=>i.checked=false);
    if(sel) sel.value="Todas";
    if(estadoSel) estadoSel.value = "Todas";
    if(cidadeSel) cidadeSel.value = "Todas";
    closeFilterPanelIfOpen();

    // 4) Renderizar SOMENTE APÓS termos calculado e ordenado allData
    // Se renderCards retornar promise, await; se não, Promise.resolve faz o trabalho.
    await Promise.resolve(renderCards(userCoords.lat, userCoords.lon));

    // 5) Force repaint / garantir DOM atualizado
    await new Promise(r => requestAnimationFrame(r));

    // 6) Atualizar os textos de distância nos cards (baseado em allData.__dist ou atributos do card)
    updateCardDistancesFromAllData(userCoords.lat, userCoords.lon);

    // 7) Reordenar DOM dos cards conforme allData.__dist (garante posição correta mesmo se renderCards não respeitou ordem)
    reorderDomCardsByAllDataDist();

    // 8) calcular nearest e exibir feedback
    const nearest = allData.find(d => isFinite(d.__dist) && d.__dist !== Infinity) || null;
    if(nearest){
      const minD = nearest.__dist;
      const container=$("container");
      if(container){
        const cards=container.querySelectorAll(".card");
        for(const c of cards){
          if((c.dataset.loja||"") === (nearest.lojaKey || "")){ c.classList.add("nearest"); }
          else { c.classList.remove("nearest"); }
        }
      }
      setFeedback(`Loja mais próxima: ${nearest.nome} (${formatDistanceBr(minD)} km).`);
    } else {
      setFeedback("Localização obtida — nenhuma loja futura encontrada com coordenadas.");
    }

  } catch(err){
    console.warn("meLocalize error:",err);
    try {
      if(err && (err.code===3||err.code===2||err.message==="Timeout externo")){
        const ipCoords = await fetchIpFallback();
        if(ipCoords){
          userCoords = {lat: ipCoords.lat, lon: ipCoords.lon};

          // repetir o pipeline com coords por IP
          computeDistancesForAllData(userCoords.lat, userCoords.lon);
          try{ allData.sort((a,b)=>{ const da=isFinite(a.__dist)?a.__dist:Infinity; const db=isFinite(b.__dist)?b.__dist:Infinity; return da-db; }); } catch(e){ console.warn("Ordenação fallback falhou:", e); }

          await Promise.resolve(renderCards(userCoords.lat, userCoords.lon));
          await new Promise(r => requestAnimationFrame(r));
          updateCardDistancesFromAllData(userCoords.lat, userCoords.lon);
          reorderDomCardsByAllDataDist();

          setFeedback("Localização aproximada por IP obtida — distâncias atualizadas.");
          return;
        }
      }
    } catch(e){ console.warn("IP fallback error:", e); }
    if(err && err.code===1){ setFeedback("Permissão de localização negada. Habilite nas configurações do site."); return; }
    setFeedback("Não foi possível obter sua localização. Verifique HTTPS/Permissões/GPS.");
  } finally { meLocalizeRunning = false; if(btn) btn.disabled = false; }
}

/* cache clear */
async function clearCacheAndReload(){
  try{ localStorage.removeItem(CACHE_KEY); localStorage.removeItem(CACHE_TIME_KEY); } catch(e){}
  setFeedback("Filtros removidos. Recarregando...");
  await init(true);
}

/* init */
async function init(forceReload=false){
  const btn=$("btnLocalize"); if(btn) btn.onclick=meLocalize;
  const btnClear=$("btnClearCache"); if(btnClear) btnClear.onclick=clearCacheAndReload;
  document.addEventListener("click",(e)=>{ const toggle=$("filtersToggle"); const panel=$("checkboxFilters"); if(!toggle||!panel) return; if(toggle.contains(e.target)||panel.contains(e.target)) return; closeFilterPanelIfOpen(); });
  window.addEventListener("resize",()=>{ closeFilterPanelIfOpen(); });
  try{
    setFeedback("Carregando dados...");
    await loadAndPrepareData(forceReload);
    populateFilter();
    renderCards();
    setTimeout(()=>setFeedback(""),400);
  } catch(err){
    console.error(err);
    setFeedback("Erro ao carregar dados. Veja console (F12).");
    const container=$("container");
    if(container) container.innerHTML="<p style='color:crimson;text-align:center;'>Erro ao carregar dados.</p>";
  }
}

/* Garantir que init rode apenas após o DOM estar pronto */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { init().catch(err=>console.error("init error:",err)); });
} else {
  init().catch(err=>console.error("init error:",err));
}


const logo = document.querySelector(".main-header .logo img");

/* POPUP / CARROSSEL / registro de página (mantive iguais) */
window.addEventListener('load', () => {
  const popup = document.getElementById('blackFridayPopup');
  const closeBtn = document.getElementById('blackFridayClose');
  const boraBtn = document.getElementById('blackFridayBtn');
  if (!popup) return;
  function closePopup() { popup.style.display = 'none'; }
  if (closeBtn) closeBtn.addEventListener('click', closePopup);
  if (boraBtn) boraBtn.addEventListener('click', closePopup);
});

let index = 0;
const slides = document.querySelectorAll(".black_friday-slide");
function showSlide(i) {
  if(!slides || !slides.length) return;
  slides.forEach(s => s.classList.remove("active"));
  slides[i].classList.add("active");
}
function nextSlide() {
  index = (index + 1) % slides.length;
  showSlide(index);
}
if (slides && slides.length) {
  setInterval(nextSlide, 5000);
  showSlide(index);
}

fetch(`/api/registrar?pagina=${window.location.pathname.replace('/', '') || 'index'}`);
