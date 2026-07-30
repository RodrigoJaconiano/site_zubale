/* script.js — integrado: CSV/JSON fetch, cache, geolocalização, filtros e cards.
   Revisão 2026-07-30: remapeamento robusto de imagens, fallback sequencial,
   correção do cache de datas, filtros Estado/Cidade e listeners duplicados. */

const JSON_URL =
  "https://script.google.com/macros/s/AKfycbxIchf_yVY28y0TQxA0tc6ygi4Axcmcsg2CoW-aTMypersUjvH5u4Kp0I62Y7T5DpEg/exec";

const PUB_ID =
  "2PACX-1vQBDKbeXYi4xycW9bnnOoXLByemROrrE9-wW0gMS-yuKMl67PrYRN78Jy239cDsslh6iP8tgj_rV9nZ";

const CSV_URL =
  `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?output=csv`;

const CACHE_KEY = "agenda_allData_v2";
const CACHE_TIME_KEY = "agenda_allData_time_v2";
const CACHE_TTL_MS = 1000 * 60 * 3;

let allData = [];
let userCoords = null;
let lastRender = {
  userLat: null,
  userLng: null
};

let globalUiEventsBound = false;

const $ = id => document.getElementById(id);

const normalize = value =>
  (value ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\-_]/g, "");

function removeDiacriticsKeepSpaces(value) {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function capitalizeFirst(value) {
  if (!value) return "";

  return value[0].toUpperCase() +
    value.slice(1).toLowerCase();
}

function firstTokenKey(value) {
  if (!value) return "";

  const first =
    String(value).trim().split(/\s+/)[0] || "";

  return removeDiacriticsKeepSpaces(first)
    .toLowerCase()
    .replace(/[^\w]/g, "");
}

function firstTokenLabel(value) {
  if (!value) return "";

  const first =
    String(value).trim().split(/\s+/)[0] || "";

  const noAccent =
    removeDiacriticsKeepSpaces(first)
      .replace(/[^\w\s]/g, "");

  return capitalizeFirst(noAccent);
}

function formatDistanceBr(km) {
  if (!isFinite(km)) return "";

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(km);
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2];

  if (!values.every(value => isFinite(Number(value)))) {
    return NaN;
  }

  lat1 = Number(lat1);
  lon1 = Number(lon1);
  lat2 = Number(lat2);
  lon2 = Number(lon2);

  const earthRadiusKm = 6371;

  const dLat =
    (lat2 - lat1) * Math.PI / 180;

  const dLon =
    (lon2 - lon1) * Math.PI / 180;

  const calculation =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return 2 *
    earthRadiusKm *
    Math.atan2(
      Math.sqrt(calculation),
      Math.sqrt(1 - calculation)
    );
}

function formatDateBr(date) {
  if (
    !(date instanceof Date) ||
    isNaN(date.getTime())
  ) {
    return "";
  }

  const day =
    date.getDate()
      .toString()
      .padStart(2, "0");

  const month =
    (date.getMonth() + 1)
      .toString()
      .padStart(2, "0");

  const year =
    date.getFullYear()
      .toString()
      .slice(-2);

  return `${day}/${month}/${year}`;
}

/* =========================================================
   IMAGENS DAS REDES
   ========================================================= */

const DEFAULT_STORE_IMAGE =
  "/images/default.jpg";

/*
  Cada rede pode ter vários nomes e abreviações.

  O navegador tenta os arquivos na ordem declarada.
  Se o primeiro não existir, tenta o segundo.
  Se nenhum existir, usa default.jpg.
*/

const STORE_IMAGE_RULES = [
  {
    key: "atc",
    tokens: [
      "atc",
      "atacadao"
    ],
    prefixes: [
      "atacadao"
    ],
    files: [
      "/images/Foto Atacadão.png",
      "/images/atacadao.png"
    ]
  },

  {
    key: "sams",
    tokens: [
      "sams",
      "sam"
    ],
    prefixes: [
      "sams",
      "samsclub"
    ],
    files: [
      "/images/Foto Sams.png",
      "/images/sams.png"
    ]
  },

  {
    key: "carrefour",
    tokens: [
      "crfo",
      "carrefour",
      "hiper"
    ],
    prefixes: [
      "carrefour",
      "hipercarrefour"
    ],
    files: [
      "/images/Foto Carrefour.png",
      "/images/carrefour.png"
    ]
  },

  {
    key: "atk",
    tokens: [
      "atk",
      "atakarejo"
    ],
    prefixes: [
      "atakarejo"
    ],
    files: [
      "/images/Foto Atakarejo.png",
      "/images/atakarejo.png"
    ]
  },

  {
    key: "dom",
    tokens: [
      "dom",
    ],
    prefixes: [
      "dom"
    ],
    files: [
      "/images/Foto Dom.png",
      "/images/dom.png"
    ]
  },

  {
    key: "ner",
    tokens: [
      "ner",
    ],
    prefixes: [
      "ner"
    ],
    files: [
      "/images/Foto NER.png",
      "/images/ner.png"
    ]
  },

  {
    key: "pri",
    tokens: [
      "pri",
      "princesa",
    ],
    prefixes: [
      "princesa"
    ],
    files: [
      "/images/Foto Princesa.png",
      "/images/princesa.png"
    ]
  },

  {
    key: "ner",
    tokens: [
      "ner",
      "nova era",
    ],
    prefixes: [
      "ner",
      "novaera",
    ],
    files: [
      "/images/novaera.png",
      "/images/ner.png"
    ]
  },

  {
    key: "coop",
    tokens: [
      "coop"
    ],
    prefixes: [
      "coop"
    ],
    files: [
      "/images/Foto COOP.png",
      "/images/coop.png"
    ]
  },

  {
    key: "gbarbosa",
    tokens: [
      "gbarbosa"
    ],
    prefixes: [
      "gbarbosa"
    ],
    files: [
      "/images/Foto GBarbosa.png",
      "/images/gbarbosa.png"
    ]
  },

  {
    key: "amg",
    tokens: [
      "amg",
      "amigao"
    ],
    prefixes: [
      "amigao"
    ],
    files: [
      "/images/Foto Amigão.png",
      "/images/amigao.png"
    ]
  },

  {
    key: "prz",
    tokens: [
      "prz",
      "prezunic"
    ],
    prefixes: [
      "prezunic"
    ],
    files: [
      "/images/Foto Prezunic.png",
      "/images/prezunic.png"
    ]
  },

  {
    key: "mer",
    tokens: [
      "mer",
      "mercantil"
    ],
    prefixes: [
      "mercantil"
    ],
    files: [
      "/images/Foto Mercantil.png",
      "/images/mercantil.png"
    ]
  },

  {
    key: "dlt",
    tokens: [
      "dlt",
      "delta"
    ],
    prefixes: [
      "delta"
    ],
    files: [
      "/images/delta.png",
      "/images/Foto Delta.png"
    ]
  },

  {
    key: "des",
    tokens: [
      "des",
      "desco"
    ],
    prefixes: [
      "desco"
    ],
    files: [
      "/images/desco.png",
      "/images/Foto Desco.png"
    ]
  },


  {
    key: "andorinha",
    tokens: [
      "andorinha"
    ],
    prefixes: [
      "andorinha"
    ],
    files: [
      "/images/andorinha.png",
      "/images/Foto Andorinha.png"
    ]
  },

  {
    key: "gig",
    tokens: [
      "gig"
    ],
    prefixes: [
      "giga"
    ],
    files: [
      "/images/giga.png",
      "/images/Foto Giga.png"
    ]
  },

  {
    key: "slg",
    tokens: [
      "slg",
      "superlagoa"
    ],
    prefixes: [
      "superlagoa"
    ],
    files: [
      "/images/Foto SuperLagoa.png",
      "/images/super-lagoa.png",
      "/images/superlagoa.png"
    ]
  },

  {
    key: "rol",
    tokens: [
      "rol",
      "roldao"
    ],
    prefixes: [
      "roldao"
    ],
    files: [
      "/images/Foto Roldão.png",
      "/images/roldao.png"
    ]
  },

  {
    key: "pgm",
    tokens: [
      "pgm",
      "paguemenos",
      "paguemenosbr"
    ],
    prefixes: [
      "paguemenos",
      "paguemenosbr"
    ],
    files: [
      "/images/Foto PagueMenosBR.png",
      "/images/pague-menos.png",
      "/images/paguemenos.png"
    ]
  },

  {
    key: "boa",
    tokens: [
      "boa"
    ],
    prefixes: [
      "boa"
    ],
    files: [
      "/images/Foto BOA Supermercados.png",
      "/images/boa.png"
    ]
  },

  {
    key: "99",
    tokens: [
      "99",
      "99food"
    ],
    prefixes: [
      "99",
      "99food"
    ],
    files: [
      "/images/Foto 99.png",
      "/images/99.png"
    ]
  },

  {
    key: "asi",
    tokens: [
      "asi",
      "assai"
    ],
    prefixes: [
      "assai"
    ],
    files: [
      "/images/Foto AssaiAtacadista.png",
      "/images/assai.png"
    ]
  },

  {
    key: "barbosa",
    tokens: [
      "barbosa"
    ],
    prefixes: [
      "barbosa"
    ],
    files: [
      "/images/Foto barbosa.png",
      "/images/barbosa.png"
    ]
  },

  {
    key: "sonda",
    tokens: [
      "sonda",
      "sda"
    ],
    prefixes: [
      "sonda"
    ],
    files: [
      "/images/Foto Sonda.png",
      "/images/sonda.png"
    ]
  },

  {
    key: "oba",
    tokens: [
      "oba"
    ],
    prefixes: [
      "oba"
    ],
    files: [
      "/images/Foto Oba.png",
      "/images/oba.png"
    ]
  },

  {
    key: "goodbom",
    tokens: [
      "gob",
      "goodbom"
    ],
    prefixes: [
      "goodbom"
    ],
    files: [
      "/images/Foto Goodbom.png",
      "/images/goodbom.png"
    ]
  },

  {
    key: "hirota",
    tokens: [
      "hrt",
      "hirota"
    ],
    prefixes: [
      "hirota"
    ],
    files: [
      "/images/Foto Hirota.png",
      "/images/hirota.png"
    ]
  },

  {
    key: "bretas",
    tokens: [
      "bre",
      "bretas"
    ],
    prefixes: [
      "bretas"
    ],
    files: [
      "/images/Foto Bretas.png",
      "/images/bretas.png"
    ]
  },

  {
    key: "giga",
    tokens: [
      "gig",
      "giga"
    ],
    prefixes: [
      "giga"
    ],
    files: [
      "/images/Foto Giga.png",
      "/images/giga.png"
    ]
  },

  {
    key: "nagumo",
    tokens: [
      "ngm",
      "nagumo"
    ],
    prefixes: [
      "nagumo"
    ],
    files: [
      "/images/Foto Nagumo.png",
      "/images/nagumo.png"
    ]
  },

  {
    key: "ame",
    tokens: [
      "ame",
      "amemarket"
    ],
    prefixes: [
      "ame",
      "amemarket"
    ],
    files: [
      "/images/Foto Ame.png",
      "/images/ame.png"
    ]
  },

  {
    key: "ike",
    tokens: [
      "ike"
    ],
    prefixes: [
      "ike"
    ],
    files: [
      "/images/Foto IKE.png",
      "/images/ike.png"
    ]
  },

  {
    key: "tenda",
    tokens: [
      "tenda"
    ],
    prefixes: [
      "tenda"
    ],
    files: [
      "/images/Foto Tenda.png",
      "/images/tenda.png"
    ]
  }
];

const imageFailureLog = new Set();

function normalizeStoreName(value) {
  return removeDiacriticsKeepSpaces(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getStoreImageRule(storeName) {
  const normalized =
    normalizeStoreName(storeName);

  const compact =
    normalized.replace(/\s+/g, "");

  const firstToken =
    normalized.split(" ")[0] || "";

  return STORE_IMAGE_RULES.find(rule => {
    const tokenMatch =
      rule.tokens.some(token => {
        const normalizedToken =
          normalizeStoreName(token)
            .replace(/\s+/g, "");

        return firstToken === normalizedToken;
      });

    const prefixMatch =
      rule.prefixes.some(prefix => {
        const normalizedPrefix =
          normalizeStoreName(prefix)
            .replace(/\s+/g, "");

        return compact.startsWith(
          normalizedPrefix
        );
      });

    return tokenMatch || prefixMatch;
  }) || null;
}

function getLojaImageCandidates(storeName) {
  const rule =
    getStoreImageRule(storeName);

  const files =
    rule?.files || [];

  return [
    ...new Set([
      ...files,
      DEFAULT_STORE_IMAGE
    ])
  ];
}

function getLojaImage(storeName) {
  return getLojaImageCandidates(storeName)[0];
}

function applyLojaImage(imageElement, storeName) {
  const rule =
    getStoreImageRule(storeName);

  const candidates =
    getLojaImageCandidates(storeName);

  const failed = [];

  let candidateIndex = 0;

  const tryNextImage = () => {
    const nextSource =
      candidates[candidateIndex++];

    if (!nextSource) {
      imageElement.onerror = null;
      imageElement.src =
        DEFAULT_STORE_IMAGE;

      return;
    }

    imageElement.onerror = () => {
      failed.push(nextSource);

      if (
        candidateIndex <
        candidates.length
      ) {
        tryNextImage();
        return;
      }

      imageElement.onerror = null;

      const logKey =
        rule?.key ||
        firstTokenKey(storeName) ||
        storeName;

      if (!imageFailureLog.has(logKey)) {
        imageFailureLog.add(logKey);

        console.warn(
          `[IMAGEM] Nenhum arquivo específico foi encontrado para "${storeName}".`,
          {
            rede: rule?.key || "não mapeada",
            caminhosTestados: failed,
            fallback: DEFAULT_STORE_IMAGE
          }
        );
      }
    };

    imageElement.src = nextSource;
  };

  tryNextImage();
}

/* =========================================================
   CSV
   ========================================================= */

function csvToObjects(csvText) {
  const rows = [];

  let currentCell = "";
  let currentRow = [];
  let inQuotes = false;

  for (
    let index = 0;
    index < csvText.length;
    index++
  ) {
    const character =
      csvText[index];

    if (character === '"') {
      if (
        inQuotes &&
        csvText[index + 1] === '"'
      ) {
        currentCell += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (
      character === "," &&
      !inQuotes
    ) {
      currentRow.push(currentCell);
      currentCell = "";
    } else if (
      (
        character === "\n" ||
        character === "\r"
      ) &&
      !inQuotes
    ) {
      if (
        character === "\r" &&
        csvText[index + 1] === "\n"
      ) {
        index++;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);

      currentRow = [];
      currentCell = "";
    } else {
      currentCell += character;
    }
  }

  if (
    currentCell !== "" ||
    currentRow.length
  ) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (!rows.length) {
    return [];
  }

  const headers =
    rows.shift()
      .map(header => header.trim());

  return rows.map(row => {
    const object = {};

    for (
      let index = 0;
      index < headers.length;
      index++
    ) {
      object[headers[index]] =
        (row[index] ?? "").trim();
    }

    object.__cells =
      row.map(cell =>
        (cell ?? "")
          .toString()
          .trim()
      );

    return object;
  });
}

async function fetchJsonEndpoint() {
  const response =
    await fetch(JSON_URL, {
      cache: "no-store"
    });

  if (!response.ok) {
    throw new Error(
      `JSON endpoint retornou ${response.status}`
    );
  }

  return await response.json();
}

async function fetchCsvFallback() {
  const response =
    await fetch(CSV_URL, {
      cache: "no-store"
    });

  if (!response.ok) {
    throw new Error(
      `Falha ao buscar CSV: ${response.status}`
    );
  }

  const text =
    await response.text();

  if (
    /^\s*<!doctype html/i.test(text) ||
    /<html[\s>]/i.test(text)
  ) {
    throw new Error(
      "O endereço do CSV retornou HTML. Verifique se a planilha está publicada."
    );
  }

  return csvToObjects(text);
}

function findField(object, possibleKeys) {
  if (
    !object ||
    typeof object !== "object"
  ) {
    return undefined;
  }

  const keyMap = {};

  for (
    const originalKey
    of Object.keys(object)
  ) {
    keyMap[
      originalKey
        .trim()
        .toLowerCase()
    ] = originalKey;
  }

  for (
    const possibleKey
    of possibleKeys
  ) {
    const normalizedKey =
      String(possibleKey)
        .trim()
        .toLowerCase();

    const originalKey =
      keyMap[normalizedKey];

    if (
      originalKey &&
      object[originalKey] !== undefined
    ) {
      return object[originalKey];
    }
  }

  return undefined;
}

/* =========================================================
   COORDENADAS E DATAS
   ========================================================= */

function parseCoordinate(rawValue) {
  if (
    rawValue === undefined ||
    rawValue === null
  ) {
    return NaN;
  }

  const value =
    String(rawValue).trim();

  if (!value) {
    return NaN;
  }

  const match =
    value.match(/-?\d+[.,]?\d*/);

  if (!match) {
    return NaN;
  }

  const coordinate =
    parseFloat(
      match[0].replace(",", ".")
    );

  return isFinite(coordinate)
    ? coordinate
    : NaN;
}

function extractLatLngFromRow(rowObject) {
  const latitudeKeys = [
    "Latitude",
    "LAT",
    "Lat",
    "latitude",
    "lat",
    "LATITUDE"
  ];

  const longitudeKeys = [
    "Longitude",
    "LNG",
    "Long",
    "LONG",
    "longitude",
    "long",
    "LONGITUDE",
    "Lng",
    "LON",
    "Lon"
  ];

  let latitude = NaN;
  let longitude = NaN;

  const rawLatitude =
    findField(
      rowObject,
      latitudeKeys
    );

  const rawLongitude =
    findField(
      rowObject,
      longitudeKeys
    );

  if (rawLatitude !== undefined) {
    latitude =
      parseCoordinate(rawLatitude);
  }

  if (rawLongitude !== undefined) {
    longitude =
      parseCoordinate(rawLongitude);
  }

  if (
    !isFinite(latitude) &&
    Array.isArray(rowObject.__cells) &&
    rowObject.__cells.length > 7
  ) {
    latitude =
      parseCoordinate(
        rowObject.__cells[7]
      );
  }

  if (
    !isFinite(longitude) &&
    Array.isArray(rowObject.__cells) &&
    rowObject.__cells.length > 8
  ) {
    longitude =
      parseCoordinate(
        rowObject.__cells[8]
      );
  }

  if (
    !isFinite(latitude) ||
    !isFinite(longitude)
  ) {
    const joinedValues =
      Array.isArray(rowObject.__cells)
        ? rowObject.__cells.join(" ")
        : Object.values(rowObject)
          .join(" ");

    const coordinateMatches =
      joinedValues.match(
        /-?\d+[.,]?\d*/g
      );

    if (
      coordinateMatches &&
      coordinateMatches.length >= 2
    ) {
      if (!isFinite(latitude)) {
        latitude = parseFloat(
          coordinateMatches[
            coordinateMatches.length - 2
          ].replace(",", ".")
        );
      }

      if (!isFinite(longitude)) {
        longitude = parseFloat(
          coordinateMatches[
            coordinateMatches.length - 1
          ].replace(",", ".")
        );
      }
    }
  }

  if (!isFinite(latitude)) {
    latitude = NaN;
  }

  if (!isFinite(longitude)) {
    longitude = NaN;
  }

  return {
    lat: latitude,
    lng: longitude
  };
}

function parseDatePreferDDMM(rawValue) {
  if (!rawValue) {
    return null;
  }

  const value =
    String(rawValue).trim();

  const isoMatch =
    value.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/
    );

  if (isoMatch) {
    const year =
      Number(isoMatch[1]);

    const month =
      Number(isoMatch[2]);

    const day =
      Number(isoMatch[3]);

    const date =
      new Date(
        year,
        month - 1,
        day
      );

    date.setHours(0, 0, 0, 0);

    return isNaN(date.getTime())
      ? null
      : date;
  }

  const parts =
    value
      .split(/[\/\-\.\s]/)
      .filter(Boolean);

  if (parts.length >= 2) {
    let [
      firstPart,
      secondPart,
      thirdPart
    ] =
      parts.map(part =>
        part.replace(/\D/g, "")
      );

    const day =
      parseInt(firstPart, 10);

    const month =
      parseInt(secondPart, 10);

    let year =
      thirdPart
        ? parseInt(thirdPart, 10)
        : new Date().getFullYear();

    if (year < 100) {
      year += 2000;
    }

    if (year < 1900) {
      year =
        new Date().getFullYear();
    }

    const date =
      new Date(
        year,
        month - 1,
        day
      );

    date.setHours(0, 0, 0, 0);

    return isNaN(date.getTime())
      ? null
      : date;
  }

  const date =
    new Date(value);

  date.setHours(0, 0, 0, 0);

  return isNaN(date.getTime())
    ? null
    : date;
}

/* =========================================================
   CARREGAMENTO DOS DADOS
   ========================================================= */

async function loadAndPrepareData(
  forceReload = false
) {
  try {
    if (!forceReload) {
      const cachedContent =
        localStorage.getItem(
          CACHE_KEY
        );

      const cacheTime =
        parseInt(
          localStorage.getItem(
            CACHE_TIME_KEY
          ) || "0",
          10
        );

      const cacheIsValid =
        cachedContent &&
        (
          Date.now() - cacheTime
        ) < CACHE_TTL_MS;

      if (cacheIsValid) {
        try {
          const parsedCache =
            JSON.parse(
              cachedContent
            );

          if (
            Array.isArray(parsedCache) &&
            parsedCache.length
          ) {
            allData =
              parsedCache
                .map(item => {
                  const revivedDate =
                    item?.dateObj
                      ? new Date(
                        item.dateObj
                      )
                      : null;

                  return {
                    ...item,

                    dateObj:
                      revivedDate instanceof Date &&
                      !isNaN(
                        revivedDate.getTime()
                      )
                        ? revivedDate
                        : null,

                    lojaKey:
                      item?.lojaKey ||
                      firstTokenKey(
                        item?.nome || ""
                      ),

                    lojaNorm:
                      item?.lojaNorm ||
                      normalize(
                        item?.nome || ""
                      )
                  };
                })
                .filter(item =>
                  item.nome &&
                  item.dateObj instanceof Date &&
                  !isNaN(
                    item.dateObj.getTime()
                  )
                );

            console.log(
              "Dados carregados do cache:",
              allData.length
            );

            return;
          }
        } catch (cacheError) {
          console.warn(
            "Falha ao ler cache. Limpando o cache.",
            cacheError
          );

          localStorage.removeItem(
            CACHE_KEY
          );

          localStorage.removeItem(
            CACHE_TIME_KEY
          );
        }
      }
    }
  } catch (storageError) {
    console.warn(
      "Erro ao acessar localStorage:",
      storageError
    );
  }

  let rawData = [];

  try {
    rawData =
      await fetchCsvFallback();

    console.log(
      "CSV carregado:",
      rawData.length,
      "linhas"
    );
  } catch (csvError) {
    console.error(
      "Falha ao carregar CSV:",
      csvError
    );

    setFeedback(
      "Erro ao buscar CSV: " +
      (
        csvError?.message ||
        "verifique o console"
      )
    );

    rawData = [];
  }

  const mappedData =
    rawData.map(row => {
      const storeName =
        findField(row, [
          "Nome da Loja",
          "Loja",
          "Nome",
          "nome",
          "Loja Nome"
        ]) ||
        findField(row, ["A"]) ||
        row.__cells?.[0] ||
        "";

      const trainingDate =
        findField(row, [
          "Dia do treinamento",
          "Dia",
          "Data",
          "Data do treinamento"
        ]) ||
        row.__cells?.[1] ||
        "";

      const shift =
        findField(row, [
          "Turno",
          "turno"
        ]) ||
        row.__cells?.[2] ||
        "";

      const link =
        findField(row, [
          "Link SquareSpace",
          "Link"
        ]) ||
        row.__cells?.[3] ||
        "";

      const imageFilled =
        findField(row, [
          "Imagem Preenchida corretamente?",
          "Imagem"
        ]) ||
        row.__cells?.[5] ||
        "";

      /*
        A planilha atual utiliza:
        coluna J, índice 9 = Estado
        coluna K, índice 10 = Cidade
      */

      const state =
        row.__cells?.[9] ?? "";

      const city =
        row.__cells?.[10] ?? "";

      const {
        lat,
        lng
      } =
        extractLatLngFromRow(row);

      const dateObject =
        parseDatePreferDDMM(
          trainingDate
        );

      const cleanStoreName =
        String(storeName).trim();

      return {
        raw: row,

        nome: cleanStoreName,

        turno: shift,

        link,

        imgOk: imageFilled,

        lat:
          isFinite(lat)
            ? Number(lat)
            : NaN,

        lng:
          isFinite(lng)
            ? Number(lng)
            : NaN,

        dateObj: dateObject,

        estado:
          String(state).trim(),

        cidade:
          String(city).trim(),

        lojaKey:
          firstTokenKey(
            cleanStoreName
          )
      };
    });

  const today =
    new Date();

  today.setHours(0, 0, 0, 0);

  const cutoffDate =
    new Date(today);

  cutoffDate.setDate(
    today.getDate() - 4
  );

  allData =
    mappedData
      .filter(item =>
        item.nome &&
        item.dateObj instanceof Date &&
        !isNaN(
          item.dateObj.getTime()
        )
      )
      .filter(item =>
        item.dateObj >= cutoffDate
      )
      .map(item => ({
        ...item,

        lojaNorm:
          normalize(item.nome)
      }))
      .sort((first, second) => {
        const comparisonDate =
          new Date();

        comparisonDate.setHours(
          0,
          0,
          0,
          0
        );

        const firstIsPast =
          first.dateObj <
          comparisonDate;

        const secondIsPast =
          second.dateObj <
          comparisonDate;

        if (
          firstIsPast !==
          secondIsPast
        ) {
          return firstIsPast
            ? 1
            : -1;
        }

        return (
          first.dateObj -
          second.dateObj
        );
      });

  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify(allData)
    );

    localStorage.setItem(
      CACHE_TIME_KEY,
      Date.now().toString()
    );
  } catch (cacheWriteError) {
    console.warn(
      "Não foi possível gravar o cache:",
      cacheWriteError
    );
  }
}

/* =========================================================
   INTERFACE
   ========================================================= */

function setFeedback(message) {
  const feedback =
    $("feedback");

  if (feedback) {
    feedback.textContent =
      message;
  }
}

function handleFilterChange() {
  try {
    renderCards();
  } catch (filterError) {
    console.warn(
      "Erro ao aplicar os filtros:",
      filterError
    );
  }
}

function ensureLabelFor(
  element,
  labelText
) {
  if (
    !element ||
    !element.id
  ) {
    return null;
  }

  const previousElement =
    element.previousElementSibling;

  if (
    previousElement?.classList
      ?.contains("filter-label")
  ) {
    previousElement.textContent =
      labelText;

    return previousElement;
  }

  const label =
    document.createElement("label");

  label.className =
    "filter-label";

  label.htmlFor =
    element.id;

  label.style.marginRight =
    "4px";

  label.style.fontWeight =
    "600";

  label.textContent =
    labelText;

  element.parentNode.insertBefore(
    label,
    element
  );

  return label;
}

function createCheckbox(
  id,
  value,
  labelText,
  name
) {
  const wrapper =
    document.createElement("div");

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

  const input =
    document.createElement("input");

  input.type = "checkbox";
  input.id = id;
  input.value = value;
  input.name = name;
  input.className = "filter-checkbox";
  input.style.flex = "0 0 auto";
  input.style.margin = "0";

  const label =
    document.createElement("label");

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

  wrapper.addEventListener(
    "click",
    event => {
      event.stopPropagation();

      if (event.target === input) {
        return;
      }

      input.checked =
        !input.checked;

      input.dispatchEvent(
        new Event("change", {
          bubbles: true
        })
      );
    }
  );

  return {
    wrapper,
    input,
    label
  };
}

function populateFilter() {
  const legacyStoreSelect =
    $("lojaFilter");

  const checkboxContainer =
    $("checkboxFilters");

  if (!checkboxContainer) {
    return;
  }

  if (legacyStoreSelect) {
    legacyStoreSelect.style.display =
      "none";
  }

  const legacyCitySelect =
    $("cidadeFilter");

  if (legacyCitySelect) {
    legacyCitySelect.style.display =
      "none";
  }

  const legacyStateSelect =
    $("estadoFilter");

  if (legacyStateSelect) {
    legacyStateSelect.style.display =
      "none";
  }

  checkboxContainer.innerHTML =
    "";

  checkboxContainer.classList.add(
    "filters-panel"
  );

  checkboxContainer.classList.add(
    "checkbox-filters"
  );

  checkboxContainer.setAttribute(
    "aria-hidden",
    "true"
  );

  checkboxContainer.style.overflow =
    "visible";

  checkboxContainer.style.transition =
    "max-height .25s ease";

  checkboxContainer.style.maxHeight =
    "0";

  const header =
    document.createElement("div");

  header.className =
    "filters-header";

  header.style.display =
    "flex";

  header.style.justifyContent =
    "space-between";

  header.style.alignItems =
    "center";

  header.style.marginBottom =
    "8px";

  const headerTitle =
    document.createElement("div");

  headerTitle.textContent = "";
  headerTitle.style.fontWeight = "700";

  header.appendChild(
    headerTitle
  );

  checkboxContainer.appendChild(
    header
  );

  const clearButton =
    document.createElement("button");

  clearButton.type = "button";
  clearButton.textContent = "";
  clearButton.className =
    "btn-clear-filters";

  clearButton.classList.add(
    "btn-clear-filters--invisible"
  );

  clearButton.style.cursor =
    "pointer";

  clearButton.setAttribute(
    "aria-hidden",
    "true"
  );

  clearButton.tabIndex = -1;
  clearButton.disabled = true;

  clearButton.addEventListener(
    "click",
    () => {
      checkboxContainer
        .querySelectorAll(
          'input[type="checkbox"]'
        )
        .forEach(input => {
          input.checked = false;
        });

      if (legacyStoreSelect) {
        legacyStoreSelect.value =
          "Todas";
      }

      if (legacyStateSelect) {
        legacyStateSelect.value =
          "Todas";
      }

      if (legacyCitySelect) {
        legacyCitySelect.value =
          "Todas";
      }

      handleFilterChange();
    }
  );

  const groupsWrapper =
    document.createElement("div");

  groupsWrapper.className =
    "filters-groups";

  groupsWrapper.style.display =
    "flex";

  groupsWrapper.style.gap =
    "18px";

  groupsWrapper.style.flexWrap =
    "nowrap";

  groupsWrapper.style.width =
    "100%";

  groupsWrapper.style.alignItems =
    "flex-start";

  function createFilterGroup(
    title,
    id
  ) {
    const column =
      document.createElement("div");

    column.className =
      "filter-group";

    column.style.flex =
      "1 1 0";

    column.style.minWidth =
      "0";

    column.style.boxSizing =
      "border-box";

    column.style.display =
      "flex";

    column.style.flexDirection =
      "column";

    column.style.gap =
      "8px";

    const titleElement =
      document.createElement("div");

    titleElement.textContent =
      title;

    titleElement.style.fontWeight =
      "700";

    titleElement.style.marginBottom =
      "6px";

    column.appendChild(
      titleElement
    );

    const list =
      document.createElement("div");

    list.id = id;
    list.className = "filters-list";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.width = "100%";
    list.style.minWidth = "0";

    list.style.maxHeight =
      "calc(var(--filter-item-height, 36px) * 10)";

    list.style.overflowY =
      "auto";

    list.style.WebkitOverflowScrolling =
      "touch";

    list.style.padding =
      "8px";

    list.style.border =
      "1px solid rgba(0, 0, 0, 0.06)";

    list.style.borderRadius =
      "8px";

    list.style.boxSizing =
      "border-box";

    column.appendChild(list);

    return {
      column,
      list
    };
  }

  const storesGroup =
    createFilterGroup(
      "Redes",
      "lojasFiltersContainer"
    );

  const statesGroup =
    createFilterGroup(
      "Estados",
      "estadosFiltersContainer"
    );

  const citiesGroup =
    createFilterGroup(
      "Cidades",
      "cidadesFiltersContainer"
    );

  groupsWrapper.appendChild(
    storesGroup.column
  );

  groupsWrapper.appendChild(
    statesGroup.column
  );

  groupsWrapper.appendChild(
    citiesGroup.column
  );

  checkboxContainer.appendChild(
    groupsWrapper
  );

  const storesMap =
    new Map();

  const statesMap =
    new Map();

  const citiesMap =
    new Map();

  for (const item of allData) {
    const storeKey =
      item.lojaKey ||
      firstTokenKey(
        item.nome || ""
      );

    if (
      storeKey &&
      !storesMap.has(storeKey)
    ) {
      storesMap.set(
        storeKey,
        firstTokenLabel(
          item.nome || ""
        )
      );
    }

    const state =
      String(
        item.estado || ""
      ).trim();

    const normalizedState =
      normalize(state);

    if (
      state &&
      !statesMap.has(
        normalizedState
      )
    ) {
      statesMap.set(
        normalizedState,
        state
      );
    }

    const city =
      String(
        item.cidade || ""
      ).trim();

    const normalizedCity =
      normalize(city);

    if (
      city &&
      !citiesMap.has(
        normalizedCity
      )
    ) {
      citiesMap.set(
        normalizedCity,
        city
      );
    }
  }

  const storeEntries =
    Array.from(
      storesMap.entries()
    ).sort((first, second) =>
      first[1].localeCompare(
        second[1],
        "pt-BR"
      )
    );

  const stateEntries =
    Array.from(
      statesMap.entries()
    ).sort((first, second) =>
      first[1].localeCompare(
        second[1],
        "pt-BR"
      )
    );

  const cityEntries =
    Array.from(
      citiesMap.entries()
    ).sort((first, second) =>
      first[1].localeCompare(
        second[1],
        "pt-BR"
      )
    );

  for (
    const [
      storeKey,
      storeLabel
    ] of storeEntries
  ) {
    const id =
      "chk_loja_" +
      storeKey.replace(/\W/g, "_");

    const {
      wrapper,
      input
    } =
      createCheckbox(
        id,
        storeKey,
        storeLabel,
        "loja"
      );

    storesGroup.list.appendChild(
      wrapper
    );

    input.addEventListener(
      "change",
      handleFilterChange
    );
  }

  for (
    const [
      normalizedState,
      displayState
    ] of stateEntries
  ) {
    const id =
      "chk_estado_" +
      normalizedState.replace(
        /\W/g,
        "_"
      );

    const {
      wrapper,
      input
    } =
      createCheckbox(
        id,
        normalizedState,
        displayState,
        "estado"
      );

    statesGroup.list.appendChild(
      wrapper
    );

    input.addEventListener(
      "change",
      handleFilterChange
    );
  }

  for (
    const [
      normalizedCity,
      displayCity
    ] of cityEntries
  ) {
    const id =
      "chk_cidade_" +
      normalizedCity.replace(
        /\W/g,
        "_"
      );

    const {
      wrapper,
      input
    } =
      createCheckbox(
        id,
        normalizedCity,
        displayCity,
        "cidade"
      );

    citiesGroup.list.appendChild(
      wrapper
    );

    input.addEventListener(
      "change",
      handleFilterChange
    );
  }

  const filterToggle =
    $("filtersToggle");

  if (filterToggle) {
    filterToggle.setAttribute(
      "aria-expanded",
      "false"
    );

    filterToggle.onclick =
      event => {
        event.preventDefault();

        const isOpen =
          checkboxContainer
            .classList
            .toggle("open");

        checkboxContainer.setAttribute(
          "aria-hidden",
          String(!isOpen)
        );

        if (isOpen) {
          checkboxContainer.style.maxHeight =
            "1200px";

          filterToggle.setAttribute(
            "aria-expanded",
            "true"
          );
        } else {
          checkboxContainer.style.maxHeight =
            "0";

          filterToggle.setAttribute(
            "aria-expanded",
            "false"
          );
        }
      };
  } else {
    checkboxContainer.classList.add(
      "open"
    );

    checkboxContainer.setAttribute(
      "aria-hidden",
      "false"
    );

    checkboxContainer.style.maxHeight =
      "1200px";
  }

  const controls =
    document.querySelector(
      ".controls"
    );

  if (controls) {
    const existingButton =
      controls.querySelector(
        ".btn-clear-filters"
      );

    existingButton?.remove();

    controls.appendChild(
      clearButton
    );
  } else if (
    checkboxContainer.parentNode
  ) {
    const existingButton =
      checkboxContainer.parentNode
        .querySelector(
          ".btn-clear-filters"
        );

    existingButton?.remove();

    checkboxContainer.parentNode
      .insertBefore(
        clearButton,
        checkboxContainer.nextSibling
      );
  }
}

function closeFilterPanelIfOpen() {
  const toggle =
    $("filtersToggle");

  const panel =
    $("checkboxFilters");

  if (!panel || !toggle) {
    return;
  }

  if (
    panel.classList.contains("open")
  ) {
    panel.classList.remove("open");

    panel.setAttribute(
      "aria-hidden",
      "true"
    );

    panel.style.maxHeight =
      "0";

    toggle.setAttribute(
      "aria-expanded",
      "false"
    );
  }
}

/* =========================================================
   RENDERIZAÇÃO DOS CARDS
   ========================================================= */

function renderCards(
  userLatitude = undefined,
  userLongitude = undefined
) {
  if (
    userLatitude !== undefined &&
    userLongitude !== undefined &&
    isFinite(Number(userLatitude)) &&
    isFinite(Number(userLongitude))
  ) {
    userCoords = {
      lat: Number(userLatitude),
      lon: Number(userLongitude)
    };
  }

  const container =
    $("container");

  if (!container) {
    console.warn(
      "Elemento #container não encontrado."
    );

    setFeedback(
      "Erro: elemento visual #container não encontrado."
    );

    return;
  }

  container.innerHTML = "";

  const legacyStoreSelect =
    $("lojaFilter");

  const storesContainer =
    document.getElementById(
      "lojasFiltersContainer"
    );

  const statesContainer =
    document.getElementById(
      "estadosFiltersContainer"
    );

  const citiesContainer =
    document.getElementById(
      "cidadesFiltersContainer"
    );

  let checkedStores = [];

  if (storesContainer) {
    checkedStores =
      Array.from(
        storesContainer.querySelectorAll(
          'input[type="checkbox"]:checked'
        )
      ).map(input => input.value);
  }

  const fallbackStoreValue =
    legacyStoreSelect
      ? (
        legacyStoreSelect.value ??
        "Todas"
      )
      : "Todas";

  let checkedStates = [];

  if (statesContainer) {
    checkedStates =
      Array.from(
        statesContainer.querySelectorAll(
          'input[type="checkbox"]:checked'
        )
      ).map(input => input.value);
  }

  let checkedCities = [];

  if (citiesContainer) {
    checkedCities =
      Array.from(
        citiesContainer.querySelectorAll(
          'input[type="checkbox"]:checked'
        )
      ).map(input => input.value);
  }

  const legacyFilterValue =
    checkedStores.length
      ? null
      : fallbackStoreValue;

  const hasStateFilter =
    checkedStates.length > 0;

  const hasCityFilter =
    checkedCities.length > 0;

  const today =
    new Date();

  today.setHours(0, 0, 0, 0);

  let orderedData =
    allData.slice();

  if (checkedStores.length) {
    const storeSet =
      new Set(checkedStores);

    orderedData =
      orderedData.filter(item =>
        storeSet.has(item.lojaKey)
      );
  } else if (
    legacyFilterValue &&
    legacyFilterValue !== "Todas"
  ) {
    orderedData =
      orderedData.filter(item =>
        normalize(item.nome) ===
        normalize(legacyFilterValue)
      );
  }

  if (hasStateFilter) {
    const stateSet =
      new Set(
        checkedStates.map(String)
      );

    orderedData =
      orderedData.filter(item =>
        stateSet.has(
          normalize(
            item.estado || ""
          )
        )
      );
  }

  if (hasCityFilter) {
    const citySet =
      new Set(
        checkedCities.map(String)
      );

    orderedData =
      orderedData.filter(item =>
        citySet.has(
          normalize(
            item.cidade || ""
          )
        )
      );
  }

  if (!orderedData.length) {
    setFeedback(
      "Nenhum treinamento encontrado."
    );

    return;
  }

  setFeedback("");

  const locationIsActive =
    userCoords &&
    isFinite(userCoords.lat) &&
    isFinite(userCoords.lon);

  if (locationIsActive) {
    const futureItems =
      orderedData.filter(item =>
        item.dateObj instanceof Date &&
        !isNaN(
          item.dateObj.getTime()
        ) &&
        item.dateObj >= today
      );

    const pastItems =
      orderedData.filter(item =>
        !(
          item.dateObj instanceof Date &&
          !isNaN(
            item.dateObj.getTime()
          ) &&
          item.dateObj >= today
        )
      );

    const futureItemsWithDistance =
      futureItems
        .map(item => {
          const hasCoordinates =
            isFinite(item.lat) &&
            isFinite(item.lng);

          const distance =
            hasCoordinates
              ? distanceKm(
                userCoords.lat,
                userCoords.lon,
                item.lat,
                item.lng
              )
              : Infinity;

          return {
            ...item,

            __dist:
              isFinite(distance)
                ? Number(distance)
                : Infinity,

            __hasCoords:
              hasCoordinates
          };
        })
        .sort((first, second) => {
          const firstDistance =
            isFinite(first.__dist)
              ? first.__dist
              : Infinity;

          const secondDistance =
            isFinite(second.__dist)
              ? second.__dist
              : Infinity;

          return (
            firstDistance -
            secondDistance
          );
        });

    const mappedPastItems =
      pastItems.map(item => ({
        ...item,

        __dist: null,

        __hasCoords:
          isFinite(item.lat) &&
          isFinite(item.lng)
      }));

    orderedData =
      futureItemsWithDistance.concat(
        mappedPastItems
      );
  } else {
    orderedData =
      orderedData.map(item => ({
        ...item,

        __dist: null,

        __hasCoords:
          isFinite(item.lat) &&
          isFinite(item.lng)
      }));
  }

  const fragment =
    document.createDocumentFragment();

  for (const item of orderedData) {
    const pastDays =
      item.dateObj instanceof Date &&
      !isNaN(item.dateObj.getTime())
        ? Math.floor(
          (
            today - item.dateObj
          ) /
          (
            1000 *
            60 *
            60 *
            24
          )
        )
        : 0;

    const isPast =
      item.dateObj instanceof Date
        ? item.dateObj < today
        : false;

    const isRecentPast =
      isPast &&
      pastDays <= 3;

    const card =
      document.createElement(
        "article"
      );

    card.className =
      "card" +
      (
        isRecentPast
          ? " past"
          : ""
      );

    card.setAttribute(
      "tabindex",
      "0"
    );

    card.dataset.loja =
      item.lojaKey ||
      normalize(item.nome);

    card.dataset.lat =
      String(item.lat);

    card.dataset.lng =
      String(item.lng);

    if (item.link) {
      card.style.cursor =
        "pointer";

      card.addEventListener(
        "click",
        event => {
          const targetTag =
            event.target.tagName
              .toLowerCase();

          if (
            targetTag === "a" ||
            targetTag === "button"
          ) {
            return;
          }

          window.open(
            item.link,
            "_blank",
            "noopener"
          );
        }
      );

      card.addEventListener(
        "keydown",
        event => {
          if (
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();

            window.open(
              item.link,
              "_blank",
              "noopener"
            );
          }
        }
      );
    }

    const image =
      document.createElement("img");

    image.alt = item.nome;
    image.loading = "lazy";
    image.decoding = "async";

    applyLojaImage(
      image,
      item.nome
    );

    card.appendChild(image);

    const body =
      document.createElement("div");

    body.className =
      "card-body";

    const title =
      document.createElement("div");

    title.className =
      "card-title";

    const nameNode =
      document.createElement("span");

    nameNode.textContent =
      item.nome;

    title.appendChild(
      nameNode
    );

    if (
      locationIsActive &&
      item.__hasCoords &&
      isFinite(item.__dist)
    ) {
      const distanceStrong =
        document.createElement(
          "strong"
        );

      distanceStrong.style.marginLeft =
        "8px";

      distanceStrong.style.fontWeight =
        "700";

      distanceStrong.style.color =
        "var(--primary)";

      distanceStrong.textContent =
        `- a ${formatDistanceBr(item.__dist)} km`;

      title.appendChild(
        distanceStrong
      );
    }

    body.appendChild(title);

    const subtitle =
      document.createElement("div");

    subtitle.className =
      "card-sub";

    let formattedDate = "";

    if (
      item.dateObj instanceof Date &&
      !isNaN(
        item.dateObj.getTime()
      )
    ) {
      formattedDate =
        formatDateBr(
          item.dateObj
        );
    } else if (item.raw) {
      const rawDate =
        findField(item.raw, [
          "Dia do treinamento",
          "Dia",
          "Data",
          "Data do treinamento"
        ]) ||
        item.raw.__cells?.[1] ||
        "";

      const fallbackDate =
        parseDatePreferDDMM(
          rawDate
        );

      if (fallbackDate) {
        formattedDate =
          formatDateBr(
            fallbackDate
          );
      }
    }

    subtitle.textContent =
      `${formattedDate} | ${item.turno || ""}`;

    body.appendChild(
      subtitle
    );

    if (
      locationIsActive &&
      item.__hasCoords &&
      isFinite(item.__dist)
    ) {
      const distanceElement =
        document.createElement(
          "div"
        );

      distanceElement.className =
        "card-distance";

      distanceElement.textContent =
        `📍 ${formatDistanceBr(item.__dist)} km de você`;

      body.appendChild(
        distanceElement
      );
    }

    const metadata =
      document.createElement("div");

    metadata.className =
      "card-meta";

    const metadataParts = [];

    if (item.estado) {
      metadataParts.push(
        item.estado
      );
    }

    if (item.cidade) {
      metadataParts.push(
        item.cidade
      );
    }

    if (metadataParts.length) {
      metadata.textContent =
        metadataParts.join(" — ");
    }

    if (metadata.textContent) {
      body.appendChild(
        metadata
      );
    }

    card.appendChild(body);
    fragment.appendChild(card);
  }

  container.appendChild(
    fragment
  );
}

/* =========================================================
   GEOLOCALIZAÇÃO
   ========================================================= */

function getCurrentPositionPromise(
  options = {},
  timeoutMilliseconds = null
) {
  return new Promise(
    (resolve, reject) => {
      if (!navigator.geolocation) {
        const error =
          new Error(
            "Geolocation API não suportada"
          );

        error.code = 0;

        reject(error);
        return;
      }

      let timer = null;

      const handleSuccess =
        position => {
          if (timer) {
            clearTimeout(timer);
          }

          resolve(position);
        };

      const handleError =
        error => {
          if (timer) {
            clearTimeout(timer);
          }

          reject(error);
        };

      try {
        navigator.geolocation
          .getCurrentPosition(
            handleSuccess,
            handleError,
            options
          );
      } catch (error) {
        reject(error);
        return;
      }

      if (
        timeoutMilliseconds &&
        timeoutMilliseconds > 0
      ) {
        timer = setTimeout(
          () => {
            const error =
              new Error(
                "Timeout externo"
              );

            error.code = 3;

            reject(error);
          },
          timeoutMilliseconds
        );
      }
    }
  );
}

async function obtainPositionStrategy() {
  try {
    const position =
      await getCurrentPositionPromise(
        {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 300000
        },
        7000
      );

    return {
      lat:
        Number(
          position.coords.latitude
        ),

      lon:
        Number(
          position.coords.longitude
        )
    };
  } catch (quickError) {
    console.warn(
      "Localização rápida não funcionou:",
      quickError
    );
  }

  const accuratePosition =
    await getCurrentPositionPromise(
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      },
      18000
    );

  return {
    lat:
      Number(
        accuratePosition
          .coords
          .latitude
      ),

    lon:
      Number(
        accuratePosition
          .coords
          .longitude
      )
  };
}

async function fetchIpFallback() {
  try {
    setFeedback(
      "Tentando localização aproximada por IP..."
    );

    const response =
      await fetch(
        "https://ipapi.co/json/"
      );

    if (!response.ok) {
      return null;
    }

    const data =
      await response.json();

    if (
      data &&
      data.latitude &&
      data.longitude
    ) {
      return {
        lat:
          parseFloat(
            data.latitude
          ),

        lon:
          parseFloat(
            data.longitude
          )
      };
    }
  } catch (error) {
    console.warn(
      "Erro na localização por IP:",
      error
    );
  }

  return null;
}

function computeDistancesForAllData(
  latitude,
  longitude
) {
  const today =
    new Date();

  today.setHours(0, 0, 0, 0);

  if (!Array.isArray(allData)) {
    return;
  }

  for (const item of allData) {
    try {
      const isFutureTraining =
        item?.dateObj instanceof Date &&
        !isNaN(
          item.dateObj.getTime()
        ) &&
        item.dateObj >= today;

      const hasCoordinates =
        isFinite(item?.lat) &&
        isFinite(item?.lng);

      if (
        isFutureTraining &&
        hasCoordinates
      ) {
        item.__dist =
          distanceKm(
            latitude,
            longitude,
            item.lat,
            item.lng
          );
      } else {
        item.__dist =
          Infinity;
      }
    } catch (error) {
      item.__dist =
        Infinity;
    }
  }
}

function reorderDomCardsByAllDataDist() {
  const container =
    $("container");

  if (!container) {
    return;
  }

  const cards =
    Array.from(
      container.querySelectorAll(
        ".card"
      )
    );

  if (!cards.length) {
    return;
  }

  const distanceMap =
    new Map();

  for (const item of allData) {
    const key =
      (
        item.lojaKey ||
        item.loja ||
        item.name ||
        item.nome ||
        ""
      ).toString();

    distanceMap.set(
      key,
      isFinite(item.__dist)
        ? item.__dist
        : Infinity
    );
  }

  cards.sort((firstCard, secondCard) => {
    const firstKey =
      (
        firstCard.dataset.loja ||
        firstCard.getAttribute(
          "data-loja"
        ) ||
        ""
      ).toString();

    const secondKey =
      (
        secondCard.dataset.loja ||
        secondCard.getAttribute(
          "data-loja"
        ) ||
        ""
      ).toString();

    const firstDistance =
      distanceMap.has(firstKey)
        ? distanceMap.get(firstKey)
        : parseFloat(
          firstCard.dataset.distance ||
          Infinity
        );

    const secondDistance =
      distanceMap.has(secondKey)
        ? distanceMap.get(secondKey)
        : parseFloat(
          secondCard.dataset.distance ||
          Infinity
        );

    return (
      (
        isFinite(firstDistance)
          ? firstDistance
          : Infinity
      ) -
      (
        isFinite(secondDistance)
          ? secondDistance
          : Infinity
      )
    );
  });

  for (const card of cards) {
    container.appendChild(card);
  }
}

function updateCardDistancesFromAllData(
  latitude,
  longitude
) {
  const container =
    $("container");

  if (!container) {
    return;
  }

  const cards =
    container.querySelectorAll(
      ".card"
    );

  for (const card of cards) {
    const storeKey =
      (
        card.dataset.loja ||
        card.getAttribute(
          "data-loja"
        ) ||
        ""
      ).toString();

    let matchingItem = null;

    if (storeKey) {
      matchingItem =
        allData.find(item =>
          (
            item.lojaKey ||
            item.loja ||
            item.nome ||
            item.name ||
            ""
          ).toString() === storeKey
        );
    }

    if (
      matchingItem &&
      isFinite(
        matchingItem.__dist
      )
    ) {
      const distance =
        matchingItem.__dist;

      writeDistanceToCard(
        card,
        distance
      );

      card.dataset.distance =
        String(distance);

      continue;
    }

    const cardLatitude =
      parseFloat(
        card.dataset.lat ??
        card.getAttribute(
          "data-lat"
        ) ??
        card.getAttribute(
          "data-latitude"
        )
      );

    const cardLongitude =
      parseFloat(
        card.dataset.lng ??
        card.getAttribute(
          "data-lng"
        ) ??
        card.getAttribute(
          "data-longitude"
        ) ??
        card.getAttribute(
          "data-lon"
        )
      );

    if (
      isFinite(cardLatitude) &&
      isFinite(cardLongitude)
    ) {
      const distance =
        distanceKm(
          latitude,
          longitude,
          cardLatitude,
          cardLongitude
        );

      writeDistanceToCard(
        card,
        distance
      );

      card.dataset.distance =
        String(distance);

      continue;
    }

    card.dataset.distance =
      String(Infinity);
  }
}

function writeDistanceToCard(
  cardElement,
  distance
) {
  const formattedNumber =
    typeof formatDistanceBr === "function"
      ? formatDistanceBr(distance)
      : String(
        Math.round(
          distance * 10
        ) / 10
      );

  const formattedText =
    `📍 ${formattedNumber} km de você`;

  const distanceElement =
    cardElement.querySelector(
      ".distance, .card-distance, .dist, [data-distance]"
    );

  if (distanceElement) {
    try {
      distanceElement.textContent =
        formattedText;
    } catch (error) {
      cardElement.setAttribute(
        "data-distance",
        String(distance)
      );
    }

    return;
  }

  try {
    const body =
      cardElement.querySelector(
        ".card-body"
      ) || cardElement;

    const newDistanceElement =
      document.createElement(
        "span"
      );

    newDistanceElement.className =
      "card-distance auto-inserted";

    newDistanceElement.textContent =
      formattedText;

    body.appendChild(
      newDistanceElement
    );
  } catch (error) {
    console.warn(
      "Não foi possível inserir a distância no card:",
      error
    );
  }
}

let meLocalizeRunning = false;

async function meLocalize() {
  if (meLocalizeRunning) {
    return;
  }

  meLocalizeRunning = true;

  const button =
    $("btnLocalize");

  if (button) {
    button.disabled = true;
  }

  try {
    if (!navigator.geolocation) {
      setFeedback(
        "Este navegador não suporta localização."
      );

      return;
    }

    if (
      navigator.permissions &&
      navigator.permissions.query
    ) {
      try {
        const permission =
          await navigator.permissions
            .query({
              name: "geolocation"
            });

        if (
          permission.state ===
          "denied"
        ) {
          setFeedback(
            "A permissão de localização está bloqueada nas configurações do navegador."
          );

          return;
        }
      } catch (permissionError) {
        console.warn(
          "Não foi possível verificar a permissão:",
          permissionError
        );
      }
    }

    if (
      !Array.isArray(allData) ||
      allData.length === 0
    ) {
      setFeedback(
        "Aguardando o carregamento dos dados..."
      );

      await loadAndPrepareData(
        true
      );

      populateFilter();
    }

    setFeedback(
      "Obtendo sua localização..."
    );

    const coordinates =
      await obtainPositionStrategy();

    userCoords = {
      lat:
        Number(
          coordinates.lat
        ),

      lon:
        Number(
          coordinates.lon
        )
    };

    computeDistancesForAllData(
      userCoords.lat,
      userCoords.lon
    );

    try {
      allData.sort(
        (first, second) => {
          const firstDistance =
            isFinite(first.__dist)
              ? first.__dist
              : Infinity;

          const secondDistance =
            isFinite(second.__dist)
              ? second.__dist
              : Infinity;

          return (
            firstDistance -
            secondDistance
          );
        }
      );
    } catch (sortError) {
      console.warn(
        "Erro ao ordenar as lojas:",
        sortError
      );
    }

    const legacyStoreSelect =
      $("lojaFilter");

    const checkboxContainer =
      $("checkboxFilters");

    const legacyStateSelect =
      $("estadoFilter");

    const legacyCitySelect =
      $("cidadeFilter");

    if (checkboxContainer) {
      checkboxContainer
        .querySelectorAll(
          'input[type="checkbox"]'
        )
        .forEach(input => {
          input.checked = false;
        });
    }

    if (legacyStoreSelect) {
      legacyStoreSelect.value =
        "Todas";
    }

    if (legacyStateSelect) {
      legacyStateSelect.value =
        "Todas";
    }

    if (legacyCitySelect) {
      legacyCitySelect.value =
        "Todas";
    }

    closeFilterPanelIfOpen();

    await Promise.resolve(
      renderCards(
        userCoords.lat,
        userCoords.lon
      )
    );

    await new Promise(resolve =>
      requestAnimationFrame(resolve)
    );

    updateCardDistancesFromAllData(
      userCoords.lat,
      userCoords.lon
    );

    reorderDomCardsByAllDataDist();

    const nearest =
      allData.find(item =>
        isFinite(item.__dist) &&
        item.__dist !== Infinity
      ) || null;

    if (nearest) {
      const container =
        $("container");

      if (container) {
        const cards =
          container.querySelectorAll(
            ".card"
          );

        for (const card of cards) {
          if (
            (
              card.dataset.loja ||
              ""
            ) ===
            (
              nearest.lojaKey ||
              ""
            )
          ) {
            card.classList.add(
              "nearest"
            );
          } else {
            card.classList.remove(
              "nearest"
            );
          }
        }
      }

      setFeedback(
        `Loja mais próxima: ${nearest.nome} (${formatDistanceBr(nearest.__dist)} km).`
      );
    } else {
      setFeedback(
        "Localização obtida, mas nenhuma loja futura possui coordenadas válidas."
      );
    }
  } catch (locationError) {
    console.warn(
      "Erro de localização:",
      locationError
    );

    try {
      const shouldUseIpFallback =
        locationError &&
        (
          locationError.code === 3 ||
          locationError.code === 2 ||
          locationError.message ===
            "Timeout externo"
        );

      if (shouldUseIpFallback) {
        const ipCoordinates =
          await fetchIpFallback();

        if (ipCoordinates) {
          userCoords = {
            lat:
              Number(
                ipCoordinates.lat
              ),

            lon:
              Number(
                ipCoordinates.lon
              )
          };

          computeDistancesForAllData(
            userCoords.lat,
            userCoords.lon
          );

          try {
            allData.sort(
              (first, second) => {
                const firstDistance =
                  isFinite(first.__dist)
                    ? first.__dist
                    : Infinity;

                const secondDistance =
                  isFinite(second.__dist)
                    ? second.__dist
                    : Infinity;

                return (
                  firstDistance -
                  secondDistance
                );
              }
            );
          } catch (fallbackSortError) {
            console.warn(
              "Falha ao ordenar com localização por IP:",
              fallbackSortError
            );
          }

          await Promise.resolve(
            renderCards(
              userCoords.lat,
              userCoords.lon
            )
          );

          await new Promise(resolve =>
            requestAnimationFrame(
              resolve
            )
          );

          updateCardDistancesFromAllData(
            userCoords.lat,
            userCoords.lon
          );

          reorderDomCardsByAllDataDist();

          setFeedback(
            "Localização aproximada por IP obtida."
          );

          return;
        }
      }
    } catch (ipFallbackError) {
      console.warn(
        "Erro no fallback por IP:",
        ipFallbackError
      );
    }

    if (
      locationError &&
      locationError.code === 1
    ) {
      setFeedback(
        "Permissão de localização negada. Libere a localização nas configurações do navegador."
      );

      return;
    }

    setFeedback(
      "Não foi possível obter sua localização. Verifique as permissões do navegador."
    );
  } finally {
    meLocalizeRunning = false;

    if (button) {
      button.disabled = false;
    }
  }
}

/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

async function clearCacheAndReload() {
  try {
    localStorage.removeItem(
      CACHE_KEY
    );

    localStorage.removeItem(
      CACHE_TIME_KEY
    );
  } catch (error) {
    console.warn(
      "Erro ao limpar o cache:",
      error
    );
  }

  setFeedback(
    "Filtros removidos. Recarregando..."
  );

  await init(true);
}

function bindGlobalUiEventsOnce() {
  if (globalUiEventsBound) {
    return;
  }

  globalUiEventsBound = true;

  document.addEventListener(
    "click",
    event => {
      const toggle =
        $("filtersToggle");

      const panel =
        $("checkboxFilters");

      if (!toggle || !panel) {
        return;
      }

      if (
        toggle.contains(
          event.target
        ) ||
        panel.contains(
          event.target
        )
      ) {
        return;
      }

      closeFilterPanelIfOpen();
    }
  );

  window.addEventListener(
    "resize",
    closeFilterPanelIfOpen
  );
}

async function init(
  forceReload = false
) {
  const locationButton =
    $("btnLocalize");

  if (locationButton) {
    locationButton.onclick =
      meLocalize;
  }

  const clearButton =
    $("btnClearCache");

  if (clearButton) {
    clearButton.onclick =
      clearCacheAndReload;
  }

  bindGlobalUiEventsOnce();

  try {
    setFeedback(
      "Carregando dados..."
    );

    await loadAndPrepareData(
      forceReload
    );

    populateFilter();
    renderCards();

    setTimeout(
      () => setFeedback(""),
      400
    );
  } catch (initializationError) {
    console.error(
      "Erro na inicialização:",
      initializationError
    );

    setFeedback(
      "Erro ao carregar os dados. Veja o console com F12."
    );

    const container =
      $("container");

    if (container) {
      container.innerHTML =
        '<p style="color: crimson; text-align: center;">Erro ao carregar os dados.</p>';
    }
  }
}

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      init().catch(error =>
        console.error(
          "Erro no init:",
          error
        )
      );
    }
  );
} else {
  init().catch(error =>
    console.error(
      "Erro no init:",
      error
    )
  );
}

/* =========================================================
   POPUP E CARROSSEL
   ========================================================= */

const logo =
  document.querySelector(
    ".main-header .logo img"
  );

window.addEventListener(
  "load",
  () => {
    const popup =
      document.getElementById(
        "blackFridayPopup"
      );

    const closeButton =
      document.getElementById(
        "blackFridayClose"
      );

    const actionButton =
      document.getElementById(
        "blackFridayBtn"
      );

    if (!popup) {
      return;
    }

    function closePopup() {
      popup.style.display =
        "none";
    }

    if (closeButton) {
      closeButton.addEventListener(
        "click",
        closePopup
      );
    }

    if (actionButton) {
      actionButton.addEventListener(
        "click",
        closePopup
      );
    }
  }
);

let slideIndex = 0;

const slides =
  document.querySelectorAll(
    ".black_friday-slide"
  );

function showSlide(index) {
  if (
    !slides ||
    !slides.length
  ) {
    return;
  }

  slides.forEach(slide =>
    slide.classList.remove(
      "active"
    )
  );

  slides[index].classList.add(
    "active"
  );
}

function nextSlide() {
  if (!slides.length) {
    return;
  }

  slideIndex =
    (
      slideIndex + 1
    ) % slides.length;

  showSlide(slideIndex);
}

if (
  slides &&
  slides.length
) {
  setInterval(
    nextSlide,
    5000
  );

  showSlide(slideIndex);
}

/* Registrar visita sem quebrar o site caso a API apresente erro */

fetch(
  `/api/registrar?pagina=${
    window.location.pathname
      .replace("/", "") ||
    "index"
  }`
).catch(error =>
  console.warn(
    "Falha ao registrar visita:",
    error
  )
);
