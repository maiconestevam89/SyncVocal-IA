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
    scope: "https://www.googleapis.com/auth/drive.readonly",
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

export async function findCustomerDriveFolder(
  accessToken: string,
  phoneDigits: string,
  formattedPhone?: string
): Promise<DriveItem | null> {
  // Padrões de busca para o telefone
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

  // Tenta encontrar a pasta do cliente por consulta Drive
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
        // Encontra o melhor match que contenha os dígitos
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
      // Ordena por maior índice de música (ex: MUSICA 02 > MUSICA 01)
      const sorted = data.files.sort((a: any, b: any) => {
        const numA = parseInt((a.name.match(/\d+/) || [0])[0], 10);
        const numB = parseInt((b.name.match(/\d+/) || [0])[0], 10);
        if (numB !== numA) return numB - numA;
        return (b.modifiedTime || "").localeCompare(a.modifiedTime || "");
      });
      return sorted[0];
    }
  }

  // Se não houver subpastas, retorna a própria pasta do cliente
  return { id: parentFolderId, name: "Raiz", mimeType: "application/vnd.google-apps.folder" };
}

export interface MusicAudioFile {
  id: string;
  name: string;
  category: "FINAL_01" | "FINAL_02" | "PLAYBACK_01" | "PLAYBACK_02" | "OTHER";
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

    if (upper.includes("FINAL") && (upper.includes("01") || upper.includes("1"))) {
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

  // Ordena para entrega: FINAL 01, FINAL 02, PLAYBACK 01, PLAYBACK 02
  const order: Record<string, number> = {
    FINAL_01: 1,
    FINAL_02: 2,
    PLAYBACK_01: 3,
    PLAYBACK_02: 4,
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
