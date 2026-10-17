import { secrets } from "base44:runtime";

function base64UrlEncode(bufferOrStr: Uint8Array | string): string {
  let base64 = "";
  if (typeof bufferOrStr === "string") {
    base64 = btoa(unescape(encodeURIComponent(bufferOrStr)));
  } else {
    let binary = "";
    const len = bufferOrStr.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bufferOrStr[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getGoogleDriveAccessToken(serviceAccountJsonRaw: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  let creds: any;
  try {
    creds = JSON.parse(serviceAccountJsonRaw.trim());
  } catch (err) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido.");
  }

  const { client_email, private_key } = creds;
  if (!client_email || !private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON precisa conter client_email e private_key.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const cleanKey = private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(cleanKey), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const encoder = new TextEncoder();
  const signatureBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signatureBytes));
  const jwt = `${unsignedToken}.${encodedSignature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao autenticar no Google Cloud (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return data.access_token;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Encontra ou cria uma pasta pelo nome dentro de uma pasta mãe
 */
export async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId = "root"
): Promise<DriveItem> {
  const safeName = name.replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=5`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });

  if (res.ok) {
    const data = await res.json();
    if (data?.files && data.files.length > 0) {
      return data.files[0];
    }
  }

  // Cria a pasta se não existir
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Erro ao criar pasta "${name}" no Drive (${createRes.status}): ${errText}`);
  }

  return await createRes.json();
}

/**
 * Garante a criação de uma hierarquia completa de pastas
 */
export async function ensureFolderHierarchy(
  accessToken: string,
  pathSegments: string[],
  rootParentId = "root"
): Promise<DriveItem> {
  // Pega o ID fixo dos secrets caso seja a raiz "MM Music", senão usa o padrão passado
  let resolvedRootId = rootParentId;
  if (pathSegments.length > 0 && pathSegments[0] === "MM Music") {
    const secretRoot = secrets.got("DRIVE_ROOT_FOLDER_ID");
    if (secretRoot) {
      resolvedRootId = secretRoot.trim();
      pathSegments = pathSegments.slice(1); // Remove "MM Music" da lista pois já estamos dentro dela pelo ID fixo
    }
  }

  let currentParentId = resolvedRootId;
  let currentFolder: DriveItem = { id: resolvedRootId, name: "MM Music", mimeType: "application/vnd.google-apps.folder" };

  for (const segment of pathSegments) {
    currentFolder = await findOrCreateFolder(accessToken, segment, currentParentId);
    currentParentId = currentFolder.id;
  }

  return currentFolder;
}

/**
 * Cria a próxima subpasta sequencial dentro da pasta do cliente (MUSICA 01, MUSICA 02, etc.)
 */
export async function createNextSequentialMusicSubfolder(
  accessToken: string,
  customerFolderId: string
): Promise<DriveItem> {
  const q = `'${customerFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });

  let maxNum = 0;
  if (res.ok) {
    const data = await res.json();
    const existing = data.files || [];
    for (const f of existing) {
      const match = f.name.match(/MUSICA\s*(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  const subfolderName = `MUSICA ${String(nextNum).padStart(2, "0")}`;

  return await findOrCreateFolder(accessToken, subfolderName, customerFolderId);
}

/**
 * Faz upload de um arquivo para uma pasta do Google Drive
 */
export async function uploadFileToDriveFolder(
  accessToken: string,
  folderId: string,
  fileName: string,
  fileData: ArrayBuffer | Uint8Array,
  mimeType = "audio/mpeg"
): Promise<DriveItem> {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType,
  };

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const metaHeader = delimiter + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + delimiter + `Content-Type: ${mimeType}\r\n\r\n`;

  const metaHeaderBytes = encoder.encode(metaHeader);
  const closeDelimiterBytes = encoder.encode(closeDelimiter);
  const rawBytes = fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : fileData;

  const bodyBytes = new Uint8Array(metaHeaderBytes.length + rawBytes.length + closeDelimiterBytes.length);
  bodyBytes.set(metaHeaderBytes, 0);
  bodyBytes.set(rawBytes, metaHeaderBytes.length);
  bodyBytes.set(closeDelimiterBytes, metaHeaderBytes.length + rawBytes.length);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: bodyBytes,
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao fazer upload de "${fileName}" para o Drive (${res.status}): ${errText}`);
  }

  return await res.json();
}

/**
 * FLUXO 10 - Copia a pasta gerada para "Pastas compartilhadas" e gera link público de leitura
 */
export async function copyFolderToSharedAndGetLink(
  accessToken: string,
  customerPhoneStr: string,
  subfolderName: string,
  sourceFolderId: string
): Promise<{ sharedFolderId: string; webViewLink: string }> {
  // 1. Garante a pasta Meu Drive\MM Music\2026\Pastas compartilhadas\[NUMERO]\[MUSICA 0X]
  const sharedCustomerFolder = await ensureFolderHierarchy(
    accessToken,
    ["MM Music", "2026", "Pastas compartilhadas", customerPhoneStr, subfolderName]
  );

  // 2. Copia todos os arquivos da pasta original para a pasta compartilhada
  const listQ = `'${sourceFolderId}' in parents and trashed = false`;
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(listQ)}&fields=files(id,name)&pageSize=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (listRes.ok) {
    const data = await listRes.json();
    for (const f of data.files || []) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/copy`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parents: [sharedCustomerFolder.id],
            name: f.name,
          }),
        });
      } catch (err) {
        console.warn(`Erro ao copiar arquivo ${f.name}:`, err);
      }
    }
  }

  // 3. Define permissão: Leitor / Qualquer pessoa com o link
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${sharedCustomerFolder.id}/permissions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "reader",
        type: "anyone",
      }),
    });
  } catch (err) {
    console.warn("Erro ao definir permissão pública na pasta compartilhada:", err);
  }

  // 4. Obtém o webViewLink
  const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${sharedCustomerFolder.id}?fields=webViewLink`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const getData = await getRes.json();
  const webViewLink = getData.webViewLink || `https://drive.google.com/drive/folders/${sharedCustomerFolder.id}`;

  return {
    sharedFolderId: sharedCustomerFolder.id,
    webViewLink,
  };
}

export async function findCustomerDriveFolder(
  accessToken: string,
  phoneDigits: string,
  formattedPhone?: string
): Promise<DriveItem | null> {
  const cleanDigits = phoneDigits.replace(/\D/g, "");
  const ddd = cleanDigits.slice(0, 2);
  const rest = cleanDigits.slice(2);
  const p1 = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
  const p2 = rest.length === 9 ? rest.slice(5) : rest.slice(4);

  const patterns = [
    formattedPhone,
    `${ddd} ${p1}-${p2}`,
    `${p1}-${p2}`,
    `(${ddd}) ${p1}-${p2}`,
    `${ddd} ${rest}`,
    `${ddd}${rest}`,
    rest,
  ].filter(Boolean) as string[];

  for (const pat of patterns) {
    const safePat = pat.replace(/'/g, "\\'");
    const q = `mimeType = 'application/vnd.google-apps.folder' and name contains '${safePat}' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=10`;
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.files && data.files.length > 0) {
        const matched = data.files.find((f: DriveItem) => {
          const fileDigits = f.name.replace(/\D/g, "");
          return fileDigits.includes(rest) || f.name.includes(pat);
        }) || data.files[0];
        return matched;
      }
    }
  }

  return null;
}

export async function findLatestMusicSubfolder(
  accessToken: string,
  parentFolderId: string
): Promise<DriveItem> {
  const q = `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime)&orderBy=name desc&pageSize=50`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });

  if (res.ok) {
    const data = await res.json();
    if (data?.files && data.files.length > 0) {
      const sorted = data.files.sort((a: any, b: any) => {
        const numA = parseInt((a.name.match(/\d+/) || [0])[0], 10);
        const numB = parseInt((b.name.match(/\d+/) || [0])[0], 10);
        if (numB !== numA) return numB - numA;
        return (b.modifiedTime || "").localeCompare(a.modifiedTime || "");
      });
      return sorted[0];
    }
  }

  return { id: parentFolderId, name: "Raiz", mimeType: "application/vnd.google-apps.folder" };
}

export interface MusicAudioFile {
  id: string;
  name: string;
  category: "FINAL_01" | "FINAL_02" | "PLAYBACK_01" | "PLAYBACK_02" | "FINAL_VOZ_01" | "FINAL_VOZ_02" | "PREVIA_01" | "PREVIA_02" | "OTHER";
}

export async function findMusicDeliveryFiles(
  accessToken: string,
  folderId: string
): Promise<MusicAudioFile[]> {
  const q = `'${folderId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size)&pageSize=50`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`Falha ao listar arquivos na pasta do Google Drive (${res.status})`);
  }

  const data = await res.json();
  const files: DriveItem[] = data.files || [];
  const result: MusicAudioFile[] = [];

  for (const f of files) {
    const upper = f.name.toUpperCase();
    let cat: MusicAudioFile["category"] = "OTHER";

    if (upper.includes("FINAL COM VOZ") && (upper.includes("01") || upper.includes("1"))) {
      cat = "FINAL_VOZ_01";
    } else if (upper.includes("FINAL COM VOZ") && (upper.includes("02") || upper.includes("2"))) {
      cat = "FINAL_VOZ_02";
    } else if (upper.includes("FINAL") && (upper.includes("01") || upper.includes("1"))) {
      cat = "FINAL_01";
    } else if (upper.includes("FINAL") && (upper.includes("02") || upper.includes("2"))) {
      cat = "FINAL_02";
    } else if (upper.includes("PLAYBACK") && (upper.includes("01") || upper.includes("1"))) {
      cat = "PLAYBACK_01";
    } else if (upper.includes("PLAYBACK") && (upper.includes("02") || upper.includes("2"))) {
      cat = "PLAYBACK_02";
    }

    if (cat !== "OTHER") {
      result.push({
        id: f.id,
        name: f.name,
        category: cat,
      });
    }
  }

  const order: Record<string, number> = {
    FINAL_01: 1,
    FINAL_02: 2,
    PLAYBACK_01: 3,
    PLAYBACK_02: 4,
    FINAL_VOZ_01: 5,
    FINAL_VOZ_02: 6,
  };

  result.sort((a, b) => (order[a.category] || 99) - (order[b.category] || 99));
  return result;
}

export async function downloadDriveFile(
  accessToken: string,
  fileId: string
): Promise<Blob> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    throw new Error(`Falha ao baixar arquivo do Drive (${res.status})`);
  }

  return await res.blob();
}
