import { secrets } from "base44:runtime";
import { JWT } from "npm:google-auth-library";

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
}

// 1. Gera o Token de Acesso usando a Conta de Serviço
export async function getGoogleDriveAccessToken(serviceAccountJsonStr: string): Promise<string> {
  const credentials = JSON.parse(serviceAccountJsonStr);
  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token as string;
}

// 2. Encontra ou cria uma pasta
export async function findOrCreateFolder(accessToken: string, folderName: string, parentId: string): Promise<DriveItem> {
  const query = `name = '${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)`;
  
  const searchRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const searchData = await searchRes.json();
  
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0];
  }
  
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    })
  });
  return await createRes.json();
}

// 3. Garante a criação da árvore de pastas principal
export async function ensureFolderHierarchy(
  accessToken: string,
  pathSegments: string[],
  rootParentId = "root"
): Promise<DriveItem> {
  let resolvedRootId = rootParentId;
  
  if (pathSegments.length > 0 && pathSegments[0] === "MM Music") {
    const secretRoot = secrets.get("DRIVE_ROOT_FOLDER_ID"); // Lendo corretamente com .get()
    if (secretRoot) {
      resolvedRootId = secretRoot.trim();
      pathSegments = pathSegments.slice(1); 
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

// 4. Cria a subpasta sequencial (ex: Música 001)
export async function createNextSequentialMusicSubfolder(accessToken: string, parentId: string): Promise<DriveItem> {
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&fields=files(name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  
  let maxNumber = 0;
  if (data.files) {
    for (const file of data.files) {
      const match = file.name.match(/^Música (\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    }
  }
  const nextNumberStr = String(maxNumber + 1).padStart(3, '0');
  return findOrCreateFolder(accessToken, `Música ${nextNumberStr}`, parentId);
}

// 5. Faz o upload do ficheiro final para a pasta designada
export async function uploadFileToDriveFolder(
  accessToken: string,
  folderId: string,
  fileName: string,
  fileBuffer: ArrayBuffer,
  mimeType: string
): Promise<any> {
  const metadata = { name: fileName, parents: [folderId] };
  const form = new FormData();
  
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([fileBuffer], { type: mimeType }));
  
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  });
  return await res.json();
}
