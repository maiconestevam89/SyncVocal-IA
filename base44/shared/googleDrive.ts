import { secrets } from "base44:runtime";

export async function ensureFolderHierarchy(
  accessToken: string,
  pathSegments: string[],
  rootParentId = "root"
): Promise<DriveItem> {
  let resolvedRootId = rootParentId;
  if (pathSegments.length > 0 && pathSegments[0] === "MM Music") {
    const secretRoot = secrets.get("DRIVE_ROOT_FOLDER_ID"); // IMPORTANTE: usar .get() e não .got()
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
